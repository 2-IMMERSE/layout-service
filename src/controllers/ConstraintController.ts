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
import { LayoutManager } from "../tools/LayoutManager";

/**
 * Constraint controller
 */
export class ConstraintController {
  /** log4js logger instance */
  private logr: log4js.Logger;

  /**
   * Create new controller instance
   */
  constructor(private ws: SocketClient) {
    this.logr = log4js.getLogger("api");
  }

  /**
   * Register this middleware with the Express application
   *
   * @param router - Osprey router to register with
   */
  public static register(router: Router, ws: SocketClient): void {
    const controller = new ConstraintController(ws);

    router.get("/context/{contextId}/dmapp/{dmappId}/constraints", (req: Request, res: Response) => {
      controller.index(req, res);
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/constraints", (req: Request, res: Response) => {
      controller.create(req, res);
    });

    router.get("/context/{contextId}/dmapp/{dmappId}/constraints/{constraintId}", (req: Request, res: Response) => {
      controller.show(req, res);
    });

    router.post("/context/{contextId}/dmapp/{dmappId}/constraints/{constraintId}", (req: Request, res: Response) => {
      controller.update(req, res);
    });

    router.delete("/context/{contextId}/dmapp/{dmappId}/constraints/{constraintId}", (req: Request, res: Response) => {
      controller.delete(req, res);
    });
  }

  /**
   * retrieve constraint set for a dmapp
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

          return res.status(200).send(dmapp.constraints);
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

          return res.status(500).json(error);
        });
  }

  /**
   * add or update a constraint
   * this triggers new layout computation
   * @param req
   * @param res
   */
  public create(req: Request, res: Response): void {
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

          const newConstraints = req.body;
          newConstraints.forEach ((constraint) => {
            /* update or add the new constraint */
            const idx = dmapp.constraints.findIndex((c) => (c.constraintId === constraint.constraintId));
            if (idx > -1) {
              dmapp.constraints[idx] = constraint;
            } else {
              dmapp.constraints.push (constraint);
            }
          });

          dmapp.save().then((dm) => {
            this.kickoffLayoutGenerator(req, res, dm, []);
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

          return res.status(500).json(error);
        });
  }

  /**
   * get a sinle constraint definition
   * @param req
   * @param res
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

          const constraint = dmapp.constraints.find ((item) => (item.constraintId === req.params.constraintId));
          if (constraint != null) {
            return res.status(200).send(constraint);
          }

          return res.status(404).send({
            status: "error",
            message: "dmapp " + req.params.dmappId + " has no such constraint",
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

          return res.status(500).json(error);
        });
  }

  /**
   * add or update a constraint
   * this triggers new layout computation if the constraints affected relevant components
   * @param req
   * @param res
   */
  public update(req: Request, res: Response): void {
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

          const idx = dmapp.constraints.findIndex((c) => (c.constraintId === req.params.constraintId));
          if (idx > -1) {
            /* update constraint */
            dmapp.constraints[idx] = req.body;
          } else {
            /* add constraint */
            dmapp.constraints.push (req.body);
          }

          dmapp.save()
            .then((dm) => {
              const affectedComponents = dm.components.map((comp) => {
                if (comp.constraintId === req.params.constraintId && comp.layout.visible) {
                  return comp.componentId;
                }
              });

              if (affectedComponents.length > 0) {
                return this.kickoffLayoutGenerator(req, res, dm, affectedComponents);
              }

              return res.status(204).send();
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

          return res.status(500).json(error);
        });
  }

  /**
   * delete a constraint
   * @param req
   * @param res
   */
  public delete(req: Request, res: Response): void {
    if (req.params.constraintId === "default") {
      const error = {
        contextId: req.params.contextId,
        dmappId: req.params.dmappId,
        status: "error",
        message: "The \"default\" constraint cannot be deleted",
      };

      return res.status(405).json(error);
    }

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

        // check if our constraint is in use
        const aggQ = [];

        aggQ.push({ $match: { "_id":  req.params.dmappId, "contextId": req.params.contextId, "components.constraintId": req.params.constraintId }});
        aggQ.push({ $project: { components: { $filter: {
          input: "$components", as: "component", cond: { $eq: ["$$component.constraintId", req.params.constraintId] },
        }}}});
        aggQ.push({ $unwind: "$components" });
        aggQ.push({ $group: { _id: null, components: { $addToSet: "$components.componentId" }}});

        return req.db.DMApps.aggregate(aggQ)
          .then((aggs) => {
            if (aggs && aggs.length > 0) {
              const error = {
                contextId: req.params.contextId,
                dmappId: req.params.dmappId,
                status: "error",
                message: "The \"" + req.params.constraintId + "\" constraint is currently in use!",
                components: aggs,
              };

              return res.status(405).json(error);
            }

            return dmapp.removeConstraint(req.params.constraintId)
              .then(() => {
                return res.status(204).send();
              });
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

        return res.status(500).json(error);
      });
  }

  /**
   * run a new layout computation after changing constraints
   * @param req
   * @param res
   * @param dmapp
   * @param components
   */
  private kickoffLayoutGenerator(req, res, dmapp, components) {
    /* get the context object and kickoff layout generation */
    req.db.Contexts.get(req.params.contextId)
        .then((ctx) => {
          if (ctx) {
            const mgr = new LayoutManager(this.ws);
            mgr.evaluateLayout(ctx, req.db)
              .then (() => {
                  mgr.notifyComponentsUpdate (req.db,  ctx._id, dmapp , components, false);
              });

            return res.status(204).send();
          } else {
            return res.status(404).send({
              status: "error",
              message: "context " + req.params.contextId + " doesn not exist",
            });
          }
        });
  }
}
