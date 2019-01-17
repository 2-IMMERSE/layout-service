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
import { Application, Request, Response } from "express";
import * as mung from "express-mung";
import * as log4js from "log4js";
import { Logger } from "../Logger";

/**
 * Express middleware for logging API calls
 */
export class ResponseLogger {
    /**
     * Register this middleware with the Express application
     * @param app - Express application to register with
     */
    public static register(app: Application): void {
        const logr = log4js.getLogger("response");

        app.use(mung.json((body: any, req: Request, res: Response) => {
          logr.debug(Logger.formatResponse(req, res, body));

          return body;
        }));
    }
}
