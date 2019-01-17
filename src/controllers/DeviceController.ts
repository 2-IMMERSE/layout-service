/*Copyright 2018 Cisco and/or its affiliates

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
import { isNullOrUndefined } from "util";
import { DocumentNotFoundError, InvalidArgumentError } from "../errors";
import { Globals} from "../globals";
import { Logger } from "../Logger";
import { IDeviceDocument } from "../model/Device";
import { SocketClient } from "../SocketClient";
import { Timestamper } from "../Timestamper";
import { LayoutManager } from "../tools/LayoutManager";

/**
 * Device controller
 */
export class DeviceController {
  private static groupCtr: number = 0;
  private logr: log4js.Logger;
  private layoutMgr: LayoutManager;
  private DEFAULT_GROUP_ID: string = "__group_default_id__";

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
    const controller = new DeviceController(ws);

    const validContextRoute = {
      contextId: { type: "string" },
    };

    const validDeviceRoute = {
      contextId: { type: "string" },
      deviceId: { type: "string" },
    };

    router.post("/context/{contextId}/devices", validContextRoute, (req: Request, res: Response) => {
      controller.add(req, res);
    });

    router.get("/context/{contextId}/devices/{deviceId}", validDeviceRoute, (req: Request, res: Response) => {
      controller.show(req, res);
    });

    router.delete("/context/{contextId}/devices/{deviceId}", validDeviceRoute, (req: Request, res: Response) => {
      controller.remove(req, res);
    });

    // Device resolutions routes
    router.get("/context/{contextId}/devices/{deviceId}/displayResolution", validDeviceRoute, (req: Request, res: Response) => {
      controller.getResolution(req, res);
    });

    router.put("/context/{contextId}/devices/{deviceId}/displayResolution", validDeviceRoute, (req: Request, res: Response) => {
      controller.updateResolution(req, res);
    });

    // Device orientation routes
    router.put("/context/{contextId}/devices/{deviceId}/orientation", validDeviceRoute, (req: Request, res: Response) => {
      controller.updateOrientation(req, res);
    });
  }

  /**
   * add a new device to a context
   * triggers layout recomputation
   * device is removed from previous context if it belonged to one
   * @param req
   * @param res
   */
  public add(req: Request, res: Response): void {
    req.db.Contexts.get(req.params.contextId)
      .then((ctx) => {
        if (!ctx) {
          return Promise.reject(
            new DocumentNotFoundError("no such context", {
              contextId: req.params.contextId,
              deviceId: req.query.deviceId,
              status: "error",
            },
          ));
        }

        return req.db.Contexts.update({
          "devices.deviceId": req.query.deviceId,
        }, {
          $pull: {
            devices: {
              deviceId: { $eq: req.query.deviceId },
            },
          },
        }, {
          multi: true,
        }).then(() => {
          // todo: re-evaluate layout for the context from which the device was pulled
          return ctx.refresh();
        });
      })
      .then((ctx) => {
        const groupid: string = this.groupName (req.body.capabilities.communalDevice, req.body.group);
        const device: IDeviceDocument = {
          deviceId: req.query.deviceId,
          caps: req.body.capabilities,
          orientation: req.query.orientation,
          regions: req.body.regionList,
          group: groupid,
        };

        if (device.caps.displayWidth > device.caps.displayHeight) {
          device.orientation = "landscape";
        } else {
          device.orientation = "portrait";
        }
        if (!device.caps.hasOwnProperty("displayResolution")) {
          device.caps.displayResolution = Globals.config.defaultDPI;
        }
        if (!device.caps.hasOwnProperty("concurrentAudio")) {
          device.caps.concurrentAudio = Globals.config.defaultConcurrentAudio;
        }

        return ctx.addDevice(device).then ((c) => {
          /* notify new device */
          this.ws.pushNotice(c._id, "devices", {
            device:     c.formatDevice(req.query.deviceId),
            timestamp:  Timestamper.getTimestampNS(),
          });
          /* re-evaluate layout to include new device */
          this.layoutMgr.evaluateLayout(c, req.db).then (() => {
            return res.status(201).json({
              contextId: c._id,
              deviceIds: c.getDeviceList(),
            });
          });
        });
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

        this.logr.error(Logger.formatMessage("Error adding device", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * retrieve device capabilities and state
   * @param req
   * @param res
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
              deviceId: req.query.deviceId,
            },
          ));
        }

        return res.status(200).json(ctx.devices[0]);
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
   * remove a device from a context
   * triggers layout recomputation
   * @param req
   * @param res
   */
  public remove(req: Request, res: Response): void {
    req.db.Contexts.get(req.params.contextId)
      .then((ctx) => {
        if (!ctx || !ctx.devices) {
          return Promise.reject(
            new DocumentNotFoundError("no such device or context", {
                contextId: req.params.contextId,
                deviceId: req.query.deviceId,
              },
            ));
        }
        const dev = ctx.getDevice(req.params.deviceId);
        if (isNullOrUndefined(dev)) {
          return Promise.reject(
            new DocumentNotFoundError("no such device in context", {
                contextId: req.params.contextId,
                deviceId: req.query.deviceId,
              },
            ));
        }

        this.ws.pushNotice(ctx._id, req.query.deviceId, {
          remove: req.query.deviceId,
          timestamp: Timestamper.getTimestampNS(),
        });

        return ctx.removeDevice(req.params.deviceId)
          .then((contxt) => {
            this.layoutMgr.evaluateLayout(contxt, req.db);
            return res.json({
              contextId: ctx._id,
              deviceIds: ctx.getDeviceList(),
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

        this.logr.error(Logger.formatMessage("Error removing device", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * return device resolution
   * @param req
   * @param res
   */
  public getResolution(req: Request, res: Response): void {
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
              deviceId: req.query.deviceId,
            },
          ));
        }

        return res.json({
          displayResolution: ctx.devices[0].caps.displayResolution,
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

        this.logr.error(Logger.formatMessage("Error getting resolution", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * update device display resolution
   * triggers layout recalculation
   * @param req
   * @param res
   */
  public updateResolution(req: Request, res: Response): void {
    req.db.Contexts.get(req.params.contextId)
      .then((ctx) => {
        if (!ctx || !ctx.devices) {
          return Promise.reject(
            new DocumentNotFoundError("no such device or context", {
              contextId: req.params.contextId,
              deviceId: req.query.deviceId,
            },
          ));
        }

        const dev = ctx.getDevice(req.params.deviceId);
        dev.caps.displayResolution =  req.body.displayResolution;
        return ctx.save()
          .then((context) => {
            res.status(204).json();
            this.layoutMgr.evaluateLayout(context, req.db);
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

        this.logr.error(Logger.formatMessage("Error updating device resolution", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * change a device's orientation (e.g. from portrait to landscape)
   * triggers layout recomputation
   * @param req
   * @param res
   */
  public updateOrientation(req: Request, res: Response): void {
    req.db.Contexts.get(req.params.contextId)
     .then((ctx) => {
        if (!ctx || !ctx.devices) {
          return Promise.reject(
            new DocumentNotFoundError("no such device or context", {
              contextId: req.params.contextId,
              deviceId: req.query.deviceId,
            },
          ));
        }

        const dev = ctx.getDevice(req.params.deviceId);

        if (isNullOrUndefined(dev)) {
         return Promise.reject(
           new DocumentNotFoundError("no such device found in context", {
               contextId: req.params.contextId,
               deviceId: req.query.deviceId,
             },
           ));
        }

          // check if it's a valid orientation
        if (! dev.caps.orientations.includes(req.query.orientation)) {
          return Promise.reject(
            new InvalidArgumentError("device orientation (" + req.query.orientation + ") not supported", {
              contextId: req.params.contextId,
              deviceId: req.params.deviceId,
            }));
        }

        /* ok, flip it */
        this.ws.pushNotice(ctx._id, req.query.deviceId, {
          device: ctx.formatDevice(req.query.deviceId),
          timestamp: Timestamper.getTimestampNS(),
        });

        if (dev.orientation !== req.query.orientation) {
            const w = dev.caps.displayWidth;
            dev.caps.displayWidth = dev.caps.displayHeight;
            dev.caps.displayHeight = w;
            dev.orientation = req.query.orientation;

            return ctx.save().then(() => {
                this.layoutMgr.evaluateLayout(ctx, req.db);
            });
        }
      })
      .then(() => {
        return res.status(204).json();
      })
      .catch(InvalidArgumentError, (err) => {
        return res.status(400).json(err);
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

        this.logr.error(Logger.formatMessage("Error updating device orientation", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * generate default group names if none was supplied (i.e., no grouping was specified)
   * @param communal
   * @param groupId
   */
  private groupName(communal: boolean, groupId: string ): string {
    if (isNullOrUndefined(groupId)) {
      /* if no group is specified return generated group per old communal/personal grouping scheme
       * i.e., all communal devices will be in one group
       * and each personal device in it's own group of one
       */
      if (communal) {
        return "communal_" + this.DEFAULT_GROUP_ID;
      }

      DeviceController.groupCtr += 1;
      return "personal_" + this.DEFAULT_GROUP_ID + String(DeviceController.groupCtr);
    }

    /* return user requested device group */
    return groupId;
  }
}
