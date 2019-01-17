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
import { toObjectID } from "iridium";
import * as log4js from "log4js";
import { Router } from "osprey";
import * as _ from "underscore";
import {isNullOrUndefined} from "util";
import { DocumentNotFoundError } from "../errors";
import { Logger } from "../Logger";
import { SocketClient } from "../SocketClient";
import { Timestamper } from "../Timestamper";
import { LayoutManager } from "../tools/LayoutManager";

/**
 * Region controller
 */
export class RegionController {
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
    const controller = new RegionController(ws);

    const validDeviceRoute = {
      contextId: { type: "string" },
      deviceId: { type: "string" },
    };

    const validRegionRoute = {
      contextId: { type: "string" },
      deviceId: { type: "string" },
      regionId: { type: "string" },
    };

    // add some routes there
    router.get("/context/{contextId}/devices/{deviceId}/region", validDeviceRoute, (req: Request, res: Response) => {
      controller.index(req, res);
    });

    router.put("/context/{contextId}/devices/{deviceId}/region", validDeviceRoute, (req: Request, res: Response) => {
      controller.add(req, res);
    });

    router.get("/context/{contextId}/devices/{deviceId}/region/{regionId}", validRegionRoute, (req: Request, res: Response) => {
      controller.show(req, res);
    });

    router.delete("/context/{contextId}/devices/{deviceId}/region/{regionId}", validRegionRoute, (req: Request, res: Response) => {
      controller.remove(req, res);
    });
  }

  /**
   * Get list of Regions
   *
   * @param req - REST request
   * @param res - REST response
   */
  public index(req: Request, res: Response): void {
    const q = {
      "_id": toObjectID(req.params.contextId),
      "devices.deviceId": req.params.deviceId,
    };

    req.db.Contexts.findOne(q, { fields: { "devices.$": 1 } })
      .then((ctx) => {
        if (!ctx || !ctx.devices) {
          return Promise.reject(
            new DocumentNotFoundError("no such device or context", {
              contextId: req.params.contextId,
              deviceId: req.params.deviceId,
            },
          ));
        }

        const ids = ctx.devices[0].regions.map((region) => {
          return region.regionId;
        });

        return res.status(200).json({
          deviceId: ctx.devices[0].deviceId,
          regionIds: ids,
        });
      })
      .catch(DocumentNotFoundError, (err) => {
        return res.status(404).json(err);
      })
      .catch((err) => {
        const error = {
          contextId: req.params.contextId,
          deviceId: req.params.deviceId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error getting device", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * add a new region
   *
   * @param req - REST request
   * @param res - REST response
   */
  public add(req: Request, res: Response): void {
    req.db.Contexts.get(req.params.contextId)
      .then((ctx) => {
        if (!ctx || !ctx.devices) {
          return Promise.reject(
            new DocumentNotFoundError("no such device or context", {
              contextId: req.params.contextId,
              deviceId: req.params.deviceId,
            },
          ));
        }

        const device = ctx.getDevice(req.params.deviceId);

        if (isNullOrUndefined(device)) {
          return Promise.reject(
            new DocumentNotFoundError("no such device found in context", {
                contextId: req.params.contextId,
                deviceId: req.params.deviceId,
              },
            ));
        }

        req.body.forEach((newRegion) => {
          if (! device.regions) {
            device.regions = [];
            device.regions.push(newRegion);
            return;
          }
          let foundit = false;
          device.regions.forEach((r) => {
            if (r.regionId === newRegion.regionId) {
              foundit = true;
              if (newRegion.hasOwnProperty("displayHeight") && r.resizable) {
                r.displayHeight = newRegion.displayHeight;
              }
              if (newRegion.hasOwnProperty("displayWidth") && r.resizable) {
                r.displayWidth = newRegion.displayWidth;
              }
              if (newRegion.hasOwnProperty("resizable")) {
                r.resizable = newRegion.resizable;
              }
            }
          });
          if (! foundit) {
            device.regions.push(newRegion);
          }
        });

        this.ws.pushNotice(ctx._id, "devices", {
          device: ctx.formatDevice(req.params.deviceId),
          timestamp: Timestamper.getTimestampNS(),
        });

        return ctx.save()
          .then((c) => {
          this.layoutMgr.evaluateLayout(c, req.db);
          return c;
        });
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
          deviceId: req.params.deviceId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error getting device", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * Get specified region data
   *
   * @param req - REST request
   * @param res - REST response
   */
  public show(req: Request, res: Response): void {
    const q = {
      "_id": toObjectID(req.params.contextId),
      "devices.deviceId": req.params.deviceId,
    };

    req.db.Contexts.findOne(q, { fields: { "devices.$": 1 } })
      .then((ctx) => {
        if (!ctx || !ctx.devices) {
          return Promise.reject(
            new DocumentNotFoundError("no such device or context", {
              contextId: req.params.contextId,
              devieId: req.params.deviceId,
            },
          ));
        }

        const region = ctx.devices[0].regions.filter((devRegion) => {
          return devRegion.regionId === req.params.regionId;
        });

        return res.json(region);
      })
      .catch(DocumentNotFoundError, (err) => {
        return res.status(404).json(err);
      })
      .catch((err) => {
        const error = {
          contextId: req.params.contextId,
          deviceId: req.params.deviceId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error getting device", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * remove a region
   *
   * @param req - REST request
   * @param res - REST response
   */
  public remove(req: Request, res: Response): void {
    req.db.Contexts.get(req.params.contextId)
      .then((ctx) => {
        if (!ctx || isNullOrUndefined(ctx.devices) || ctx.devices.length < 0) {
          return Promise.reject(
            new DocumentNotFoundError("no such device or context", {
              contextId: req.params.contextId,
              deviceId: req.params.deviceId,
            },
          ));
        }

        const device = ctx.getDevice(req.params.deviceId);

        if (isNullOrUndefined(device)) {
          return Promise.reject(
            new DocumentNotFoundError("no such device found in context", {
                contextId: req.params.contextId,
                deviceId: req.params.deviceId,
              },
            ));
        }

        device.regions = device.regions.filter((region) => {
          return region.regionId !== req.params.regionId;
        });

        this.ws.pushNotice(ctx._id, "devices", {
          device: ctx.formatDevice(req.params.deviceId),
          timestamp: Timestamper.getTimestampNS(),
        });

        ctx.save()
          .then(() => {
            this.layoutMgr.evaluateLayout(ctx, req.db);
            res.status(200).json({
              regionIds: _.pluck(device.regions, "regionId"),
            });
          });
      })
      .catch(DocumentNotFoundError, (err) => {
        return res.status(404).json(err);
      })
      .catch((err) => {
        const error = {
          contextId: req.params.contextId,
          deviceId: req.params.deviceId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error getting device", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }
}
