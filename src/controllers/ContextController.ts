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
import { Request, Response } from "express";
import * as log4js from "log4js";
import { Router } from "osprey";
import { DocumentNotFoundError } from "../errors";
import { Globals} from "../globals";
import { Logger } from "../Logger";
import { IDebugDocument } from "../model/Debug";
import { SocketClient } from "../SocketClient";
import { Timestamper } from "../Timestamper";
import { GeneratedLayout, LayoutManager } from "../tools/LayoutManager";

/**
 * Context controller
 */
export class ContextController {
  /** log4js logger instance */
  private logr: log4js.Logger;
  private layoutMgr: LayoutManager;

  /**
   * Create new controller instance
   */
  constructor(private ws: SocketClient) {
    this.logr = log4js.getLogger("api");
    this.layoutMgr = new LayoutManager(ws);
  }

  /**
   * Register this middleware with the Express application
   *
   * @param router - Osprey router to register with
   */
  public static register(router: Router, ws: SocketClient): void {
    const controller = new ContextController(ws);

    const validContextRoute = {
      contextId: { type: "string" },
    };

    // add some routes there
    router.get("/context", (req: Request, res: Response) => {
      controller.index(req, res);
    });

    router.post("/context", (req: Request, res: Response) => {
      controller.create(req, res);
    });

    router.get("/context/{contextId}", validContextRoute, (req: Request, res: Response) => {
      controller.show(req, res);
    });

    router.delete("/context/{contextId}", validContextRoute, (req: Request, res: Response) => {
      controller.delete(req, res);
    });

    router.put("/context/{contextId}/config", validContextRoute, (req: Request, res: Response) => {
      controller.updateConfig(req, res);
    });
  }

  /**
   * List contexts
   *
   * @param req - Request object
   * @param res - Response object
   */
  public index(req: Request, res: Response): void {
    const q = [];

    q.push({ $group: { _id: null, ids: { $addToSet: "$_id" } } });

    if (req.query.deviceId !== "*") {
      q.push({ $match: { "devices._id": req.query.deviceId } });
    }

    req.db.Contexts.aggregate(q)
      .then((aggs) => {
        if (!aggs || aggs.length === 0) {
          return res.json([]);
        } else {
          return res.json(aggs[0].ids);
        }
      })
      .catch((err) => {
        const error = {
          status: "error",
          error: err.message,
        };

        this.logr.error(Logger.formatMessage("Error listing contexts", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * Create a new context
   *
   * @param req - Request object
   * @param res - Response object
   */
  public create(req: Request, res: Response): void {
    let cleanup = Promise.resolve();
    const data: IDebugDocument = {};

    if (Globals.debugmode()) {
      data._id = Globals.getID();
      cleanup = this.cleanDebugContext(data._id, req);
    }

    cleanup.then(() => req.db.Contexts.insert(data))
      .then((ctx) => {
        this.ws.pushNotice ("all", "contexts", {
          context: ctx._id,
          timestamp: Timestamper.getTimestampNS(),
        });

        this.logr.info(Logger.formatMessage("Create context", {
          contextID: ctx._id,
        }));

        return res.status(201).json({
          contextId: ctx._id,
        });
      })
      .catch((err) => {
        const error = {
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error creating context", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * Show a context
   *
   * @param req - Request object
   * @param res - Response object
   */
  public show(req: Request, res: Response): void {
    req.db.Contexts.get(req.params.contextId)
      .then((ctx) => {
        if (!ctx) {
          return Promise.reject(
            new DocumentNotFoundError("no such context", {
              contextId: req.params.contextId,
            },
          ));
        }

        if (req.query.reqDeviceId === "layoutRenderer") {
          /* backdoor to retrieve entire layout */
          return Promise.resolve(this.layoutMgr.getLayout(ctx, req.db).then((layout: GeneratedLayout) => {
              return res.json ({
                contextId: req.params.contextId,
                deviceIds: ctx.getDeviceList(),
                devices: ctx.getDevices(),
                timestamp: layout.timestamp,
                layout: layout.devices,
                notplaced: layout.notPlaced,
            });
          }));
        }

        return res.json({
          contextId: ctx._id,
          deviceIds:  ctx.getDeviceList(),
          timestamp: ctx.timestamp,
        });
      })
      .catch(DocumentNotFoundError, (err) => {
        res.status(404).json(err);
      })
      .catch((err) => {
        const error = {
          contextId: req.params.contextId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error getting context", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * Delete a context
   *
   * @param req - Request object
   * @param res - Response object
   */
  public delete(req: Request, res: Response): void {
    req.db.Layouts.get( req.params.contextId )
        .then((layout) => {
          if (layout != null) {
            layout.delete();
          }
        });

    const q = [{ $match: { contextId: req.params.contextId }}];

    req.db.DMApps.aggregate(q)
        .then((aggs) => {
          if (aggs) {
            aggs.forEach((dmapp) => {
              req.db.DMApps.get(dmapp._id).then ((d) => d.delete());
            });
          }
        });

    req.db.Contexts.get(req.params.contextId)
      .then((ctx) => {
        if (!ctx) {
          return Promise.reject(
            new DocumentNotFoundError("no such context", {
              contextId: req.params.contextId,
            },
          ));
        }

        this.logr.info(Logger.formatMessage("Deleting context", {
          contextID: ctx._id,
        }));

        return ctx.delete();
      })
      .then(() => {
        return res.status(204).json();
      })
      .catch(DocumentNotFoundError, (err) => {
        return res.status(404).json(err);
      })
      .catch((err) => {
        const error = {
          contextId: req.params.contextId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error deleting context", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * Update a context config
   *
   * @param req - Request object
   * @param res - Response object
   */
  public updateConfig(req: Request, res: Response): void {
    req.db.Contexts.get(req.params.contextId)
      .then((ctx) => {
        if (!ctx) {
          return Promise.reject(
            new DocumentNotFoundError("no such context", {
              contextId: req.params.contextId,
            },
          ));
        }

        const data = {};

        if (req.query.hasOwnProperty("percentCoords")) {
          data["config.percentCoords"] = req.query.percentCoords;
        }

        if (req.query.hasOwnProperty("reduceFactor")) {
          data["config.reduceFactor"] = req.query.reduceFactor;
        }

        if (req.query.hasOwnProperty("reduceTries")) {
          data["config.reduceTries"] = req.query.reduceTries;
        }

        return ctx.save({
          $set: data,
        });
      })
      .then((ctx) => {
        this.logr.info(Logger.formatMessage("Update context config", {
          contextID: ctx._id,
        }));

        this.layoutMgr.evaluateLayout(ctx, req.db);
        return res.status(204).json();
      })
      .catch(DocumentNotFoundError, (err) => {
        return res.status(404).json(err);
      })
      .catch((err) => {
        const error = {
          contextId: req.params.contextId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error updating context config", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  private cleanDebugContext(id: string, req: Request) {
    req.db.Layouts.get( req.params.contextId )
      .then((layout) => {
        if (layout != null) {
          layout.delete();
        }
      });
    req.db.DMApps.aggregate([{ $match: { contextId: req.params.contextId }}])
      .then((aggs) => {
        if (aggs) {
          aggs.forEach((dmapp) => {
            req.db.DMApps.get(dmapp._id).then ((d) => d.delete());
          });
        }
      });

    return req.db.Contexts.get(id)
      .then((ctx) => {
         if (ctx) {
           return ctx.delete();
         } else {
           return Promise.resolve();
         }
      });
  }
}
