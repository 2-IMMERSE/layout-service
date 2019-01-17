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
import * as _ from "underscore";
import { Database } from "../Database";
import { DocumentNotFoundError } from "../errors";
import { Globals } from "../globals";
import { Logger } from "../Logger";
import { Context } from "../model/Context";
import { DMApp } from "../model/DMApp";
import { SocketClient } from "../SocketClient";
import { TimelineManager } from "../TimelineManager";
import { LayoutLoader } from "../tools/LayoutLoader";
import { GeneratedLayout, LayoutManager, Skipped } from "../tools/LayoutManager";
import { Transaction } from "../tools/Transaction";

/**
 * DMApp controller
 * handles REST API calls for DMApp actions
 */
export class DMAppController {
  /** log4js logger instance */
  private logr: log4js.Logger;
  private layoutLogr: log4js.Logger;
  private layoutMgr: LayoutManager;

  /**
   * Create new controller instance
   */
  constructor(private ws: SocketClient, private tm: TimelineManager) {
    this.logr = log4js.getLogger("api");
    this.layoutLogr = log4js.getLogger("layout");
    this.layoutMgr = new LayoutManager (ws);
  }

  /**
   * Register this middleware with the Express application
   *
   * @param router - Osprey router to register with
   */
  public static register(router: Router, ws: SocketClient, tm: TimelineManager): void {
    const controller = new DMAppController(ws, tm);

    const validContextRoute = {
      contextId: { type: "string" },
    };

    const validDMAppRoute = {
      contextId: { type: "string" },
      dmappId: { type: "string" },
    };

    // Device management routes
    router.get("/context/{contextId}/dmapp", validContextRoute, (req: Request, res: Response) => {
      controller.index(req, res);
    });

    router.post("/context/{contextId}/dmapp", validContextRoute, (req: Request, res: Response) => {
      controller.create(req, res);
    });

    router.get("/context/{contextId}/dmapp/{dmappId}", validDMAppRoute, (req: Request, res: Response) => {
      controller.show(req, res);
    });

    router.delete("/context/{contextId}/dmapp/{dmappId}", validDMAppRoute, (req: Request, res: Response) => {
      controller.delete(req, res);
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/simulate", validDMAppRoute, (req: Request, res: Response) => {
      controller.simulate(req, res);
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/actions/clockChanged", validDMAppRoute, (req: Request, res: Response) => {
      controller.clockChanged(req, res);
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/transaction", validDMAppRoute, (req: Request, res: Response) => {
      controller.transaction(req, res);
    });
  }

  /**
   * List all DMApps in a Context
   *
   * @param req - Request object
   * @param res - Response object
   */
  public index(req: Request, res: Response): void {
    const q = [];

    q.push({ $match: { contextId:  req.params.contextId } });
    q.push({ $group: { _id: null, ids: { $addToSet: "$_id" } } });

    req.db.DMApps.aggregate(q)
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

        this.logr.error(Logger.formatMessage("Error listing dmapps", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * Simulate a layout to establish viable components
   *
   * @param req - Request object
   * @param res - Response object
   */
  public simulate(req: Request, res: Response): void {
    const q = {
      contextId: req.paras.contextId,
      _id: req.params.dmappId,
    };

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

        const deviceQ = {
          "_id": req.params.contextId,
          "devices.deviceId": req.query.deviceId,
        };

        return req.db.Contexts.findOne(deviceQ, { fields: { "devices.$": 1 } })
          .then((ctx) => {
            if (!ctx) {
              return Promise.reject(
                new DocumentNotFoundError("no such context or device", {
                    contextId: req.params.contextId,
                    dmappId: req.params.dmappId,
                    deviceId: req.query.deviceId,
                  },
                ));
            }

            // simulate layout here
            return res.status(200).json({
              viable: [],
            });
          });
      });
  }

  /**
   * Load a DMApp into a Context
   *
   * @param req - Request object
   * @param res - Response object
   */
  public create(req: Request, res: Response): void {
    let cleanup = Promise.resolve();

    req.db.Contexts.get(req.params.contextId)
      .then((ctx) => {
        if (!ctx) {
          return Promise.reject(
              new DocumentNotFoundError("no such context", {
                  contextId: req.params.contextId,
                },
              ));
        }

        const body: any = {
          contextId: ctx._id,
          spec: req.body,
        };

        if (Globals.debugmode()) {
          body._id = Globals.getID();
          cleanup = this.cleanDebugDmapp(body._id, req);
        }

        return cleanup.then(() => req.db.DMApps.insert(body));
      })
      .then((dmapp) => {
          const loader = new LayoutLoader(dmapp);
          return loader.loadLayout();
      })
      .then((dmapp) => {
          this.logr.info(Logger.formatMessage("Creating dmapp", {
            contextID: dmapp.contextId,
            dmappID: dmapp._id,
          }));

          return dmapp.save();
      })
      .then((dmapp) => {
        this.sendDMAppCreationNotice (req.params.contextId, dmapp._id, req.body);

        return this.tm.createTimeline(dmapp)
          .then (() => this.tm.loadDMAppTimeline(dmapp))
          .then(() => {
            return res.status(201).json(dmapp);
          });
      })
      .catch(DocumentNotFoundError, (err) => {
        return res.status(404).json( {
            contextId: req.params.contextId,
            dmappId: req.params.dmappId,
            status: "error",
            message: "DocumentNotFoundError: " + err.message,
        });
      })
      .catch((err) => {
        const error = {
          contextId: req.params.contextId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error creating dmapp", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * Get a DMApp
   *
   * @param req - Request object
   * @param res - Response object
   */
  public show(req: Request, res: Response): void {
    const q = {
      contextId: req.params.contextId,
      _id: req.params.dmappId,
    };

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

          return req.db.Contexts.get(req.params.contextId)
              .then((ctx) => {
                  const components = [];
                  return req.db.Layouts.get(req.params.contextId)
                      .then((layout) => {
                          dmapp.components.forEach((comp) => {
                              components.push({
                                contextId: req.params.contextId,
                                DMAppId: req.params.dmappId,
                                componentId: comp.componentId,
                                constraintId: comp.constraintId,
                                config: comp.config,
                                parameters: comp.parameters,
                                startTime: comp.startTime,
                                stopTime: comp.stopTime,
                                priorities: dmapp.getResolvedPriority(ctx, comp, req.query.reqDeviceId),
                                // priorities: dmapp.getResolvedPriorities(ctx, comp, []),
                                layout: this.getComponentLayouts(layout, comp.componentId),
                              });
                          });

                          return res.status(200).json({
                              DMAppId: req.params.dmappId,
                              contextId: req.params.contextId,
                              spec: dmapp.spec,
                              components,
                              timestamp: layout != null ? layout.timestamp : dmapp.timestamp,
                          });
                      });
              })
              .catch(DocumentNotFoundError, (err) => {
                  return res.status(404).json(err);
              });
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
   * Remove a DMApp from a Context
   *
   * @param req - Request object
   * @param res - Response object
   */
  public delete(req: Request, res: Response): void {
    const q = {
      contextId: req.params.contextId,
      _id: req.params.dmappId,
    };

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

        /* update layout */
        req.db.Contexts.get(req.params.contextId)
          .then((ctx) => {
            return this.layoutMgr.evaluateLayout(ctx, req.db);
          });

        /* update timeline manager */
        return this.tm.destroyTimeline(dmapp)
            .then(() => {
                this.ws.pushNotice("bandwidth", "orchestration", { stop: { DMAppId: req.params.dmappId, contextId: req.params.contextId} });
                dmapp.components = [];
                return dmapp.delete();
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
            dmappId: req.params.dmappId,
            status: "error",
            message: err.message,
          };

          this.logr.error(Logger.formatMessage("Error deleting dmapp", error));
          this.logr.error(Logger.formatMessage(err));

          return res.status(500).json(error);
        });
  }

  /**
   * Load a DMApp into a Context
   *
   * @param req - Request object
   * @param res - Response object
   */
  public clockChanged(req: Request, res: Response): void {
    const q = {
      contextId: req.params.contextId,
      _id: req.params.dmappId,
    };

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

        // do nothing if not setup
        if (!dmapp.spec.timelineServiceUrl || dmapp.spec.timelineServiceUrl === "") {
          return Promise.resolve();
        }

        return this.tm.clockChanged(dmapp, req.body);
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
          dmappId: req.params.dmappId,
          status: "error",
          message: err.message,
        };

        this.logr.error(Logger.formatMessage("Error changing clock", error));
        this.logr.error(Logger.formatMessage(err));

        return res.status(500).json(error);
      });
  }

  /**
   * Performance a transaction on a DMApp
   *
   * @param req - Request object
   * @param res - Response object
   */
  public transaction(req: Request, res: Response): void {
    const transaction = new Transaction(parseFloat(req.body.time));
    const flags = {
        recompute: false,
        simulate: false,
        sendUpdates: false,
    };
    let mainCtx;

    req.db.Contexts.get(req.params.contextId)
      .then((ctx) => {
        if (!ctx) {
          return Promise.reject(
            new DocumentNotFoundError("no such context", {
              contextId: req.params.contextId,
              dmappId: req.params.dmappId,
            },
          ));
        }
        mainCtx = ctx;

        transaction.setContext(ctx);

        return req.db.DMApps.get(req.params.dmappId);
      })
      .catch(() =>   {
        return Promise.reject(
          new DocumentNotFoundError("no such context", {
            contextId: req.params.contextId,
            dmappId: req.params.dmappId,
        }));
      })
      .then((dmapp) => {
        if (!dmapp) {
          return Promise.reject(
            new DocumentNotFoundError("no such dmapp", {
              contextId: req.params.contextId,
              dmappId: req.params.dmappId,
            },
          ));
        }

        transaction.setDMApp(dmapp);

        req.body.actions.forEach((action) => {
           action.components.forEach((component) => {
            switch (action.action) {
              case "init":
                flags.simulate = true;
                transaction.init(component, action.config, action.parameters);
                break;
              case "start":
                flags.recompute = true;
                transaction.start(component);
                break;
              case "update":
                flags.sendUpdates = true;
                // force this for now, we should only do this if a constraintId was changed
                flags.recompute = true;
                let params = action.parameters ;
                if (typeof params === "undefined") {
                  params = null ;
                }
                transaction.update(component, params);
                break;
              case "stop":
                flags.recompute = true;
                transaction.stop(component);
                break;
              case "destroy":
                transaction.destroy(component);
                break;
              default:
                throw new Error("Unsupported action '" + action.action + "'");
            }
          });
        });

        transaction.commitInit()
          .then((transactionDmapp) => {
            if (flags.simulate) {
              this.layoutMgr.simulateLayout(mainCtx, req.db, transactionDmapp, transaction)
                .then((simulatedLayout) => {
                  this.handleNonPlaced(simulatedLayout.notPlaced, transactionDmapp,
                    transaction.getList(Transaction.INITIALIZED), Transaction.INITIALIZED);

                  return transaction.commit().then((comittedDmapp) => {
                    if (flags.recompute) {
                      this.runLayout(mainCtx, req.db, comittedDmapp, transaction, flags.sendUpdates);
                    }
                  });
                });
            } else {
              transaction.commit ().then((comittedDmapp) => {
                if (flags.recompute) {
                  this.runLayout(mainCtx, req.db, comittedDmapp, transaction, flags.sendUpdates);
                }
              });
            }

            if (flags.sendUpdates && !flags.recompute) {
              this.layoutMgr.notifyComponentsUpdate(req.db, mainCtx._id, transactionDmapp, transaction.getList(Transaction.UPDATED), true);
            }

            return res.status(204).json();
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

            this.logr.error(Logger.formatMessage("Error performing transaction", error));
            this.logr.error(Logger.formatMessage(err));
            return res.status(500).json(error);
          });
      })
      .catch(DocumentNotFoundError, (err) => {
        return res.status(404).json(err);
      });
  }

  /**
   * push dmapp creation notice to the bandwidth orchestration
   * @param contextId
   * @param dmappid
   * @param data
   */
  private sendDMAppCreationNotice(contextId: string, dmappid: string, data: any): void {
    if (data.hasOwnProperty("disableBandwidthOrchestration")) {
      return;
    }

    const obj: any = {
      DMAppId: dmappid,
      contextId,
    };

    if (data.hasOwnProperty("availableBandwidth")) {
      obj.availableBandwidth = data.availableBandwidth;
    }

    if (data.hasOwnProperty("priorityLevels")) {
      obj.priorityLevels = data.priorityLevels;
    }

    this.ws.pushNotice("bandwidth", "orchestration", {init: obj});
  }

  /**
   * @return the layout for a given component
   * @param layout
   * @param componentid
   */
  private getComponentLayouts(layout: GeneratedLayout, componentid: string): any[] {
    const layoutlist = [];

    if (layout != null && layout.devices != null) {
      layout.devices.forEach ((dev) => {
        dev.components.forEach ((comp) => {
            if (comp.componentId === componentid) {
              const clayout = comp.layout ;
              if (clayout.hasOwnProperty("deviceId") === false) {
                clayout.deviceId = dev.deviceId;
              }
              layoutlist.push(clayout);
            }
        });
    });
    }

    return layoutlist;
  }

  /**
   * run the layout algorithm for the specified dmapp and send out approriate updates and delete messages over the websocket server
   * @return the generated layout
   * @param ctx
   * @param db
   * @param dmapp
   * @param transaction
   * @param sendUpdates
   */
  private runLayout(ctx: Context, db: Database, dmapp: DMApp, transaction: Transaction, sendUpdates: boolean): Promise<GeneratedLayout> {
    // fetch previous layout so we know whom to update of stopped components
    return transaction.commit()
      .then (() => {
        return db.Layouts.findOne(ctx._id).then ((prev) => {
          return this.layoutMgr.evaluateLayout(ctx, db, prev)
            .then((layout: GeneratedLayout) => {
              this.handleNonPlaced(layout.notPlaced, dmapp, transaction.getList(Transaction.STARTED), Transaction.STARTED);
              this.layoutMgr.notifyStoppedComponents(prev, dmapp, ctx._id, ctx.getDeviceList(), transaction.getList(Transaction.STOPPED));
              this.destroyComponents(dmapp, transaction.getList(Transaction.DESTROYED));

              if (sendUpdates) {
                this.layoutMgr.notifyComponentsUpdate(db, ctx._id, dmapp, transaction.getList(Transaction.UPDATED), false);
              }

              return layout;
            });
        });
      });
  }

  /**
   * let dmapp app now of components that were not laid out in last layout generation
   * @param skipped
   * @param dmapp
   * @param requestedList
   * @param status
   */
  private handleNonPlaced(skipped: Skipped[], dmapp,  requestedList: string[], status: string): void {
    this.layoutLogr.debug(Logger.formatMessage("processing skipped", {
      dmappID: dmapp._id,
      contextID: dmapp.contextId,
      requestedList,
      status,
    }));

    const mergedSkipped: Skipped[] = [];

    for (const group of skipped) {
      let found = false;
      for (const rgroup of mergedSkipped) {
        if (group.group === rgroup.group) {
          found = true;
          rgroup.components.concat(group.components) ;
          rgroup.status += " + " + group.status;
        }
      }
      if (!found) {
        mergedSkipped.push(group) ;
      }
    }
    this.layoutLogr.debug(Logger.formatMessage("skipped: " + JSON.stringify(skipped)));
    this.layoutLogr.debug(Logger.formatMessage("mergedSkipped: " + JSON.stringify(mergedSkipped)));

    const placed = [];

    requestedList.forEach((compId) => {
      let foundInAllGroups = true ;
      for (const group of mergedSkipped) {
        if (group.components.indexOf(compId) === -1) {
          foundInAllGroups = false ;
        }
      }
      if (!foundInAllGroups) {
        placed.push(compId) ;
      }
    });

    const failedToPlaceList = _.difference(requestedList, placed);

    this.layoutLogr.debug(Logger.formatMessage("placed: " + JSON.stringify(placed) +
      "not placed on any device: " + JSON.stringify(failedToPlaceList)));

    if (failedToPlaceList.length === 0) {
      return;
    }

    // notify components that were not placed on any device

    this.layoutLogr.debug(Logger.formatMessage("preparing to send status from layout", {
      dmappID: dmapp._id,
      contextID: dmapp.contextId,
      failedToPlaceList,
      status,
    }));

    if (failedToPlaceList.length === 0) {
      return;
    }

    failedToPlaceList.forEach((c) => {
      this.tm.dmappcStatus(dmapp, c, { status });
    });

  }

  /**
   * delete components no longer active in the dmapp or layout
   * @return updated dmapp
   * @param dmapp
   * @param clist
   */
  private destroyComponents(dmapp, clist: string[]): DMApp {
    if (clist.length === 0) {
      return dmapp;
    }

    clist.forEach((c) => {
      this.tm.dmappcStatus(dmapp, c, { status: "destroyed" });
      dmapp.removeComponent(c);
    });

    return dmapp.save();
  }

  private cleanDebugDmapp(id: string, req: Request) {
    return req.db.DMApps.get(id)
      .then((dmapp) => {
        if (dmapp) {
          return dmapp.delete();
        } else {
          return Promise.resolve();
        }
      });
    }
  }
