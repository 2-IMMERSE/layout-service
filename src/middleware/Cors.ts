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
import { Application, NextFunction, Request, Response } from "express";
import * as log4js from "log4js";
import { URL } from "url";
import { Logger } from "../Logger";

/**
 * Express middleware for cors
 */
export class Cors {
  /**
   * Register this middleware with the Express application
   * @param app - Express application to register with
   */
  public static register(app: Application): void {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const logr = log4js.getLogger("cors");
      logr.debug(Logger.formatMessage("request header: " + req.header("Origin")));
      let origin = "";
      if (process.env.CORS_ORIGIN) {
        const whitelist = process.env.CORS_ORIGIN.split(",") ;
        logr.debug(Logger.formatMessage("whitelist: " + JSON.stringify(whitelist)));
        if (whitelist.indexOf(req.header("Origin")) !== -1) {
          origin = req.header("Origin");
        }
      } else {
        try {
          const ref = new URL(req.get("Referer"));
          origin = ref.protocol + "//" + ref.host;
        } catch (err) {
          origin = "*";
        }
      }

      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
      res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
      res.header("Access-Control-Allow-Credentials", "true");

      // intercept OPTIONS method
      if ("OPTIONS" === req.method) {
          res.sendStatus(200);
      } else {
          next();
      }
    });
  }
}
