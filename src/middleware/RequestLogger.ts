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
import * as bodyparser from "body-parser";
import { Application, Buffer, Request, Response } from "express";
import * as log4js from "log4js";
import { Logger } from "../Logger";

/**
 * Express middleware for logging API calls
 */
export class RequestLogger {
  /**
   * Register this middleware with the Express application
   * @param app - Express application to register with
   */
  public static register(app: Application): void {
    const logr = log4js.getLogger("request");

    app.use(bodyparser.json({
      verify: (req: Request, _res: Response, buf: Buffer) => {
        let body = "";

        if (buf.length > 0) {
          const data = buf.toString("utf-8");
          try {
            body = JSON.parse(data);
          } catch (e) {
            body = data;
          }
        }
        logr.info(Logger.formatRequest(req, body));
      },
    }));
  }
}
