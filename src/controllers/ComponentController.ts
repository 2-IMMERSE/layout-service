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
import { Request, Response } from "express";
import * as log4js from "log4js";
import { Router } from "osprey";
import { DocumentNotFoundError } from "../errors";
import { Logger } from "../Logger";
import { SocketClient } from "../SocketClient";
import { TimelineManager } from "../TimelineManager";
import { LayoutManager } from "../tools/LayoutManager";

/**
 * Component controller
 * handles component REST API
 */
export class ComponentController {
  /** log4js logger instance */
  private logr: log4js.Logger;
  /** log4js logger instance */
  private dmappLogr: log4js.Logger;

  /**
   * Create new controller instance
   */
  constructor(private ws: SocketClient, private tm: TimelineManager) {
    this.dmappLogr = log4js.getLogger("dmapp");
    this.logr = log4js.getLogger("api");
  }

  /**
   * Register this middleware with the Express application
   *
   * @param router - Osprey router to register with
   */
  public static register(router: Router, ws: SocketClient, tm: TimelineManager): void {
    const controller = new ComponentController(ws, tm);

    router.get("/context/{contextId}/dmapp/{dmappId}/components", (req: Request, res: Response) => {
      controller.index(req, res);
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/components/status", (req: Request, res: Response) => {
      controller.batchStatus(req, res);
    });

    router.get("/context/{contextId}/dmapp/{dmappId}/components/{componentId}", (req: Request, res: Response) => {
      controller.componentAction(req, res, "show");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/components/{componentId}/actions/move", (req: Request, res: Response) => {
      controller.componentAction(req, res, "move");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/components/{componentId}/actions/clone", (req: Request, res: Response) => {
      controller.componentAction(req, res, "clone");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/components/{componentId}/actions/setPriority", (req: Request, res: Response) => {
      controller.componentAction (req, res, "priority");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/components/{componentId}/actions/setPrefSize", (req: Request, res: Response) => {
      controller.componentAction (req, res, "prefsize");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/components/{componentId}/actions/status", (req: Request, res: Response) => {
      controller.componentAction (req, res, "move");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/components/{componentId}/actions/timelineEvent", (req: Request, res: Response) => {
      controller.triggerTimelineEvent(req, res);
    });

    // old routes for BC
    router.get("/context/{contextId}/dmapp/{dmappId}/component", (req: Request, res: Response) => {
      controller.index(req, res);
    });

    router.get("/context/{contextId}/dmapp/{dmappId}/component/{componentId}", (req: Request, res: Response) => {
      controller.componentAction(req, res, "show");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/component/{componentId}/actions/move", (req: Request, res: Response) => {
      controller.componentAction(req, res, "move");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/component/{componentId}/actions/clone", (req: Request, res: Response) => {
      controller.componentAction (req, res, "clone");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/component/{componentId}/actions/setPriority", (req: Request, res: Response) => {
      controller.componentAction (req, res, "priority");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/component/{componentId}/actions/setPrefSize", (req: Request, res: Response) => {
      controller.componentAction (req, res, "prefsize");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/component/{componentId}/actions/status", (req: Request, res: Response) => {
      controller.componentAction (req, res, "status");
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/component/{componentId}/actions/timelineEvent", (req: Request, res: Response) => {
      controller.triggerTimelineEvent(req, res);
    });
  }

  /**
   * retrieve the list of components in a dmapp
   * @param req
   * @param res
   */
  public index(req: Request, res: Response): void {
    const q = {
      contextId: req.params.contextId,
      _id: req.params.dmappId,
    };

    // first load the dmapp
    req.db.DMApps.findOne(q)
      .then((dmapp) => {
        if (!dmapp) {
          return Promise.reject(
            new DocumentNotFoundError("no such context or dmapp", {
              contextId: req.params.contextId,
              dmappId: req.params.dmappId,
            },
          ));
        }

        return res.status(200).json(dmapp.components);
      })
      .catch(DocumentNotFoundError, (err) => {
        return res.status(404).json(err);
      })
      .catch((err) => {
        const error = {
          contextId: req.params.contextId,
          dmappId: req.params.dmappId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error getting dmapp", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * report an event back to the timeline service if one is running
   * @param req
   * @param res
   */
  public triggerTimelineEvent(req: Request, res: Response): void {
    const q = {
      "_id": req.params.dmappId,
      "contextId": req.params.contextId,
      "components.componentId": req.params.componentId,
    };

    req.db.DMApps.findOne(q, {
      "layout": 1,
      "devices": 1,
      "components.$": 1,
    })
    .then((dmapp) => {
      if (!dmapp) {
        return Promise.reject(
          new DocumentNotFoundError("no such context or dmapp", {
              contextId: req.params.contextId,
              dmappId: req.params.dmappId,
              componentId: req.params.componentId,
            },
          ));
      }

      return this.tm.dmappcTimelineEvent(dmapp, req.query.eventId).then(res.status(204).send());
    })
    .catch((err) => {
      const error = {
        contextId: req.params.contextId,
        dmappId: req.params.dmappId,
        componentId: req.params.componentId,
        status: "error",
        message: err.message,
      };

      this.logr.error(Logger.formatMessage("Error getting component", error));
      return res.status(500).json(error);
    });
  }

  /**
   * return a set of events back to the timeline service if a one is running
   * @param req
   * @param res
   */
  private batchStatus(req: Request, res: Response): void {
    const q = {
      contextId: req.params.contextId,
      _id: req.params.dmappId,
    };

    // first load the dmapp
    req.db.DMApps.findOne(q)
      .then((dmapp) => {
        if (!dmapp) {
          return Promise.reject(
            new DocumentNotFoundError("no such context or dmapp", {
              contextId: req.params.contextId,
              dmappId: req.params.dmappId,
            },
          ));
        }

        const missingCompList = [];
        req.body.forEach((compStatus) => {
          const component = dmapp.getComponent(compStatus.componentId);
          if (!component) {
            missingCompList.push(compStatus.componentId);
          } else {
            if ((component.startTime != null) && (compStatus.status === "inited")) {
              this.dmappLogr.warn(Logger.formatMessage("got inited for component believed started: " + compStatus.componentId, {
                contextID: req.params.contextId,
                dmappID: req.params.dmappId,
              }));
            }
          }
        });
        this.tm.dmappcBatchStatus(dmapp, req.body);
        if (missingCompList.length === 0) {
          res.status(204).send();
        } else {
          res.status(500).json({
            contextId: req.params.contextId,
            dmappId: req.params.dmappId,
            status: "error",
            message: "components " +  missingCompList.join(", ") + " not found in DMApp",
          });
        }
      })
      .catch(DocumentNotFoundError, (err) => {
        return res.status(404).json(err);
      })
      .catch((err) => {
        const error = {
          contextId: req.params.contextId,
          dmappId: req.params.dmappId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error getting dmapp", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * perform an action on a component: get it, change its priority or preferred size
   * changing a characteristic triggers a new layout computation
   * @param req
   * @param res
   * @param action
   */
  private componentAction(req: Request, res: Response, action: string)  {
    const q = {
      _id: req.params.dmappId,
      contextId: req.params.contextId,
    };

    req.db.DMApps.findOne(q)
    .then((dmapp) => {
      if (!dmapp) {
        return Promise.reject(
          new DocumentNotFoundError("no such context or dmapp", {
              contextId: req.params.contextId,
              dmappId: req.params.dmappId,
              componentId: req.params.componentId,
            },
          ));
      }

      return req.db.Contexts.get(req.params.contextId)
        .then((ctx) => {
          if (!ctx) {
            return Promise.reject(
              new DocumentNotFoundError("no such context or component", {
                  contextId: req.params.contextId,
                  dmappId: req.params.dmappId,
                  componentId: req.params.componentId,
                },
              ));
          }

          const component = dmapp.getComponent(req.params.componentId);
          if (!component) {
            return Promise.reject(
              new DocumentNotFoundError("no such component", {
                  contextId: req.params.contextId,
                  dmappId: req.params.dmappId,
                  componentId: req.params.componentId,
                },
              ));
          }

          const isCommunal = ctx.isCommunalDevice(req.query.reqDeviceId);
          switch (action) {
            case "show":
              const layoutlist = [];
              req.db.Layouts.get( req.params.contextId )
                .then((layout) => {
                  layout.devices.forEach((dev) => {
                    dev.components.forEach((comp) => {
                      if (comp.componentId === req.params.componentId) {
                        layoutlist.push(comp.layout);
                      }
                    });
                  });

                  return res.status(200).send( {
                    contextId: req.params.contextId,
                    DMAppId: req.params.dmappId,
                    componentId: req.params.componentId,
                    config: component.config,
                    parameters: component.parameters,
                    startTime: component.startTime,
                    stopTime: component.stopTime,
                    priorities: dmapp.getResolvedPriority(ctx, component, req.query.reqDeviceId),
                    // priorities: dmapp.getResolvedPriorities(ctx, component, [req.query.reqDeviceId]),
                    layout: layoutlist,
                  });
                })
                .catch((err) => {
                  const resp = {
                    status: "error",
                    error: err.message,
                  };

                  this.logr.error(Logger.formatMessage("Error showing component", resp));
                  this.logr.error(Logger.formatMessage(err));

                  return res.status(500).json(resp);
                });
              break;

            case "priority":
              if (! component.hasOwnProperty("priorityOverrides")) {
                component.priorityOverrides = {};
              }

              const deviceIDs = [];
              let response = {};

              if (req.body.hasOwnProperty("personalPriority")) {
                // backwards compatibilty
                if (! component.priorityOverrides.hasOwnProperty("communal")) {
                  component.priorityOverrides.communal = {};
                  component.priorityOverrides.communal.priorities = {};
                } else if (! component.priorityOverrides.communal.hasOwnProperty("priorities")) {
                  component.priorityOverrides.communal.priorities = {};
                }
                component.priorityOverrides.communal.scope = "context";
                component.priorityOverrides.communal.priorities.context = req.body.communalPriority;
                if (! isCommunal) {
                  if (! component.priorityOverrides.hasOwnProperty("personal")) {
                    component.priorityOverrides.personal = {};
                    component.priorityOverrides.personal.priorities = {};
                  } else if (! component.priorityOverrides.personal.hasOwnProperty("priorities")) {
                    component.priorityOverrides.personal.priorities = {};
                  }
                  component.priorityOverrides.personal.scope = "device";
                  component.priorityOverrides.personal.priorities[req.query.reqDeviceId] = req.body.personalPriority;
                }
                deviceIDs.push (req.query.reqDeviceId);
                response =  {
                  contextId: req.params.contextId,
                  DMAppId: req.params.dmappId,
                  componentId: req.params.componentId,
                  priorities: dmapp.getResolvedPriority(ctx, component, req.query.reqDeviceId),
                };
              } else {
                const priorityDef = [];
                ["communal", "personal"].forEach((t) => {
                  if (req.body.hasOwnProperty (t)) {
                    priorityDef.push({
                      type: t,
                      priority: req.body.priority,
                      scope: req.body.scope,
                      group: req.body.hasOwnProperty("group") ? req.body.group : null,
                    });
                  }
                });
                req.body.forEach ((item) => {
                  item.overrides.forEach((p) => {
                    const devType = item.devtype;
                    const scope = item.scope;
                    const id = scope === "context" ? "context" : p.id;
                    if (p.priority === -1) {
                      /* remove override */
                      delete component.priorityOverrides[devType].priorities[id];
                    } else {
                      /* initial needed structures */
                      if (!component.priorityOverrides.hasOwnProperty(devType)) {
                        component.priorityOverrides[devType] = {};
                        component.priorityOverrides[devType].priorities = {};
                      } else if (!component.priorityOverrides[devType].hasOwnProperty("priorities")) {
                        component.priorityOverrides[devType].priorities = {};
                      }

                      /* set the override priority */
                      component.priorityOverrides[devType].scope = scope;
                      component.priorityOverrides[devType].priorities[id] = p.priority;

                      /* add affected devices to list for output & notify messages */
                      switch (scope) {
                        case "device":
                          deviceIDs.push(p.id);
                          break;
                        case "context":
                          ctx.getDeviceList().forEach((dev) => deviceIDs.push(dev));
                          break;
                        case "group":
                          ctx.getGroupDevices().forEach((dev) => deviceIDs.push(dev));
                          break;
                      }
                    }
                  });
                });
                response = {
                  contextId: req.params.contextId,
                  DMAppId: req.params.dmappId,
                  componentId: req.params.componentId,
                  priorities: dmapp.getResolvedPriorities(ctx, component, deviceIDs),
                };
              }

              dmapp.save().then (() =>
                  new LayoutManager(this.ws).evaluateLayout(ctx, req.db));
              LayoutManager.notifyComponentPropertyChange (this.ws, ctx , dmapp , deviceIDs, component);
              return res.status(201).json(response);

            case "prefsize":
              component.prefSize = req.body;
              dmapp.save().then (() => new LayoutManager(this.ws).evaluateLayout(ctx, req.db));
              return res.status(204).send();

            case "status":
              if ((component.startTime != null) && (req.body.status === "inited")) {
                this.dmappLogr.warn(Logger.formatMessage("got inited for component believed started: " + req.params.componentId, {
                  contextID: req.params.contextId,
                  dmappID: req.params.dmappId,
                }));

                return res.status(204).send();
              }

              return (this.tm.dmappcStatus(dmapp, component.componentId, req.body, false).then(res.status(204).send()));

            case "clone":
            case "move":
              /* todo: these were never implemented in v3, not sure what to do here */
              new LayoutManager(this.ws).evaluateLayout(ctx, req.db);
              return res.status(201).send({
                componentId:  req.params.componentId,
                DMAppId:      req.params.dmappId,
                contextId:    req.params.contextId,
              });

            default:
              return res.status(204).send();
          }
        });
      })
      .catch((err) => {
        const error = {
          contextId: req.params.contextId,
          dmappId: req.params.dmappId,
          componentId: req.params.componentId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error getting component", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }
}
