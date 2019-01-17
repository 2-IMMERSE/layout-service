/** Copyright 2018 Cisco and/or its affiliates

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */
import * as Promise from "bluebird";
import * as express from "express";
import * as log4js from "log4js";
import * as osprey from "osprey";
import * as path from "path";
import { URL } from "url";
import { ConsulClient } from "./ConsulClient";
import { Database } from "./Database";
import { Logger, LogLevel } from "./Logger";
import { SocketClient } from "./SocketClient";
import { TimelineManager } from "./TimelineManager";

// middleware
import { Cors } from "./middleware/Cors";
import { Iridium } from "./middleware/Iridium";
import { RequestLogger } from "./middleware/RequestLogger";
import { ResponseLogger } from "./middleware/ResponseLogger";

// controllers
import { ComponentController } from "./controllers/ComponentController";
import { ConstraintController } from "./controllers/ConstraintController";
import { ContextController } from "./controllers/ContextController";
import { DeviceController } from "./controllers/DeviceController";
import { DMAppController } from "./controllers/DMAppController";
import { RegionController } from "./controllers/RegionController";

interface IServerConfig {
  consulURL: string;
  mongoService: string;
  databaseName: string;
  websocketService: string;
  timelineService: string;
}

/**
 * Server
 */
export class Server {
  /** Main Express application */
  private app: express.Application;
  /** log4js logger instance */
  private logr: log4js.Logger;
  /** Main router */
  private router: osprey.Router;
  /** API path prefix */
  private prefix: string = "/layout/";
  /** API version */
  private version: string = "v4";
  /** Post listen server */
  private server: any;

  /** Consulclient instance */
  private consul: ConsulClient;
  /** SocketClient instance */
  private ws: SocketClient;
  /** Database instance */
  private db: Database;
  /** TimelineManager instance */
  private tm: TimelineManager;

  /**
   * Create a new Server
   *
   * @param config - Service config
   */
  constructor(private config: IServerConfig) {
    this.app = express();
    this.router = osprey.Router();
    this.logr = log4js.getLogger("server");

    this.app.set("x-powered-by", false);
    this.app.enable("trust proxy");

    this.ws = new SocketClient();
    this.tm = new TimelineManager(this.prefix + this.version, config.timelineService);
  }

  /**
   * Start the server using locally defined services
   * @param port - port to listen on
   */
  public startLocal(port: number): Promise<any> {
    // create our services manually here for testing
    this.ws.connect(this.config.websocketService);
    this.db = new Database({
      host: this.config.mongoService,
      port: 27017,
      database: this.config.databaseName,
    });

    this.loadMiddleware();
    this.loadControllers();
    this.initHealthcheck();
    this.createIndexes();

    return this.listen(port);
  }

  /**
   * Start the server using service discovery
   *
   * @param port - port to listen on
   */
  public start(port: number): Promise<any> {
    return this.discoverServices().then(() => {
      this.loadMiddleware();
      this.loadControllers();
      this.initHealthcheck();
      this.createIndexes();

      return this.listen(port);
    }).catch((err) => {
      this.logr.error(Logger.formatMessage(err));
      process.exit(1);
    });
  }

  /**
   * Discover services
   */
  private discoverServices(): Promise<any> {
    this.logr.debug(Logger.formatMessage("Discovering services..."));

    this.consul = new ConsulClient(this.config.consulURL);
    this.tm.setConsul(this.consul);
    const promises: Array<Promise<any>> = [];

    promises.push(this.consul.lookupService(this.config.websocketService).then((service) => {
      const addr = new URL("http://" + this.config.websocketService + ".service.consul");
      addr.port = service.ServicePort.toString();
      addr.pathname = "/layout";

      return this.ws.connect(addr.toString());
    }));

    promises.push(this.consul.lookupService(this.config.mongoService).then((service) => {
      this.db = new Database({
        host: this.config.mongoService + ".service.consul",
        port: service.ServicePort,
        database: this.config.databaseName,
      });

      return Promise.resolve();
    }));

    return Promise.all(promises);
  }

  /**
   * Ensure indexes exist in Mongo
   */
  private createIndexes(): Promise<any> {
    this.logr.debug(Logger.formatMessage("Creating indexes..."));

    return this.db.connect()
      .then(() => {
        const p = [];

        p.push(this.db.Contexts.ensureIndexes());
        p.push(this.db.DMApps.ensureIndexes());
        p.push(this.db.Layouts.ensureIndexes());

        return Promise.all(p);
      })
      .then(() => this.db.close())
      .catch((err) => {
        this.logr.error(Logger.formatMessage(err));
        process.exit(1);
      });
  }

  /**
   * Register healthcheck endpoint
   */
  private initHealthcheck(): void {
    this.logr.debug(Logger.formatMessage("Registering healthcheck..."));

    this.app.all("/healthcheck", (_req: express.Request, res: express.Response, _next: express.NextFunction) => {
      this.db.connection.stats()
      .then(() => {
        if (this.ws.alive()) {
          res.status(204).send();
        } else {
          throw new Error();
        }
      })
      .catch(() => {
        this.logr.error(Logger.formatMessage("Lost connection to services, restarting..."));
        res.status(500).send();
      });
    });
  }

  /**
   * Register middleware
   */
  private loadMiddleware(): void {
    this.logr.debug(Logger.formatMessage("Registering middleware..."));

    Cors.register(this.app);

    // only enable this in INFO or DEBUG mode
    if ((Logger.level === LogLevel.DEBUG) ||
        (Logger.level === LogLevel.INFO)) {
      RequestLogger.register(this.app);
    }

    // only enable this in verbose mode
    if (Logger.level === LogLevel.DEBUG) {
      ResponseLogger.register(this.app);
    }

    if (this.db) {
      Iridium.register(this.app, this.db);
    }
  }

  /**
   * Register routes
   */
  private loadControllers(): void {
    this.logr.debug(Logger.formatMessage("Registering controllers..."));

    ContextController.register(this.router, this.ws);
    DeviceController.register(this.router, this.ws);
    RegionController.register(this.router, this.ws);
    DMAppController.register(this.router, this.ws, this.tm);
    ComponentController.register(this.router, this.ws, this.tm);
    ConstraintController.register(this.router, this.ws);
  }

  /**
   * Start the express app listening
   *
   * @param port - port to listen on
   */
  private listen(port: number): Promise<any> {
    const ramlPath = path.resolve(__dirname, "../api", "layout-service.raml");

    return osprey.loadFile(ramlPath).then((middleware) => {
      this.app.use(this.prefix + this.version, middleware, this.router);

      this.server = this.app.listen(port, () => {
        process.on("SIGINT", () => {
          this.shutdown().then(() => {
            process.exit();
          });
        });

        this.logr.info(Logger.formatMessage("Listening on " + port));
      });
    });
  }

  /**
   * Attempt to gracefully shutdown the server
   */
  private shutdown(): Promise<any> {
    return new Promise((resolve, _reject) => {
      if (this.server) {
        this.logr.info(Logger.formatMessage("Shutting down server..."));

        this.ws.shutdown();
        this.db.close();

        this.server.close(() => {
          this.logr.info(Logger.formatMessage("Server shutdown complete. Good Bye!"));
          return resolve();
        });
      } else {
        return resolve();
      }
    });
  }
}
