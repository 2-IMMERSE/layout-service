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
import * as log4js from "log4js";
import * as _ from "underscore";
import { isNullOrUndefined } from "util";
import { Database } from "../Database";
import { Logger } from "../Logger";
import { IComponentDocument } from "../model/Component";
import { Context } from "../model/Context";
import { DMApp } from "../model/DMApp";
import { IDeviceLayoutDocument, ILayoutDocument, Layout} from "../model/Layout";
import { SocketClient } from "../SocketClient";
import { Timestamper } from "../Timestamper";
import { Util } from "../Util";
import { LayoutGenerator } from "./LayoutGenerator";
import { LayoutSimulator } from "./LayoutSimulator";
import { Transaction } from "./Transaction";

/**
 * the layout manager
 * runs the engine and deals with the resulting layout
 * i.e., persists last computation in the database
 * & sends out create & update messages via the websocket server to listening devices
 */

export class Skipped {
  public group: string;
  public status: string;
  public components: string[];

  constructor(skipped: Skipped)  {
    Object.assign(this, skipped);
  }
}

export class GeneratedLayout {
  public contextId: string;
  public devices: any[];
  public notPlaced: Skipped[];
  public timestamp: number;
}

export class LayoutManager {
  private logr: log4js.Logger;
  private layoutGenerator: LayoutGenerator;

  constructor(private ws: SocketClient) {
    this.logr = log4js.getLogger("layout");
    this.layoutGenerator = new LayoutGenerator();
  }

  /**
   * single device update
   * used when we know the components are laid out on the specified device
   * as in setPriority call which is per device
   * @param ws
   * @param ctx
   * @param dmapp
   * @param deviceIds
   * @param component
   */
  public static notifyComponentPropertyChange(ws: SocketClient,
                                              ctx: Context,
                                              dmapp: DMApp,
                                              deviceIds: string[],
                                              component: IComponentDocument): void {
    const clist = deviceIds.map((deviceId) => {
        return ({
          componentId: component.componentId,
          DMAppId:     dmapp._id,
          contextId:   ctx._id,
          deviceId,
          priorities:  dmapp.getResolvedPriorities(ctx, component, [deviceId]),
        });
    });
    ws.pushNotice (ctx._id, "componentProperties", {
      componentProperties : {
        messageId: Util.genMessageId(),
        timestamp: Timestamper.getTimestamp(),
        components: clist,
      },
    });
  }

  /**
   * run the layout generation and store / notify
   * new layout results
   * @param ctx
   * @param db
   * @param prev
   */
  public evaluateLayout(ctx: Context, db: Database, prev: ILayoutDocument = null): Promise<GeneratedLayout> {
    return this.layoutGenerator.genLayout(ctx, db)
      .then((newLayout: GeneratedLayout) => {
        const prevlayout: Promise<ILayoutDocument>
          = !isNullOrUndefined(prev) ? new Promise<ILayoutDocument>((resolve) => { resolve(prev); }) : db.Layouts.findOne(ctx._id);
        return prevlayout
          .then((prevLayout: ILayoutDocument) => {
            return db.DMApps.find({ contextId: ctx._id }).toArray()
              .then((dmappArray) => {
                return dmappArray.forEach((dmapp) => {
                  newLayout = this.manageInitedComps(ctx, prevLayout, newLayout, dmapp);
                  this.notifyCreate(ctx, prevLayout, newLayout, dmapp._id);
                  newLayout = this.manageHiddenComps(ctx, prevLayout, newLayout, dmapp);
                });
               }).then(() => {
                 this.notifyUpdate(ctx, newLayout);
                 return this.persistLayout(ctx, db, newLayout);
            });
          });
      });
  }

  /**
   * run the layout generation without storing results
   * notify devices of upcoming changes
   * used for pre-load
   * @param ctx
   * @param db
   * @param dmapp
   * @param transaction
   */
  public simulateLayout(ctx: Context, db: Database, dmapp: DMApp, transaction: Transaction): Promise<GeneratedLayout> {
    return  new LayoutSimulator(this.ws).runSimulation (db, ctx, dmapp, transaction.getList(Transaction.INITIALIZED))
      .then((simulatedLayout) => {
        return simulatedLayout;
      });
  }

  /**
   * return last stored layout
   * @param ctx
   * @param db
   */
  public getLayout(ctx: Context, db: Database): Promise<GeneratedLayout>  {
    return new Promise<GeneratedLayout>((resolve, _reject) => {
      db.Layouts.get(ctx._id).then((layout) => {
        if (layout != null) {
          resolve({
            contextId: layout._id,
            devices: layout.devices,
            notPlaced: layout.notPlaced,
            timestamp: layout.timestamp,
          });
        } else {
          this.layoutGenerator.genLayout(ctx, db).then((_layout) => {
            resolve(_layout);
          });
        }
      });
    });
  }

  /*
   * --------------------------------------------------------------
   * post layout evaluation
   * -------------------------------------------------------------- */
  /**
   * send out messages over websocket to notify of stopped components
   * @param prev            - last layout used to find state changes
   * @param dmapp
   * @param ctxid
   * @param destDevices     - list of devices to send the upate
   * @param clist           - component list to check
   */
  public notifyStoppedComponents(prev: Layout, dmapp: DMApp, ctxid: string, destDevices: string[],  clist: string[]): void {
    if (clist.length === 0) {
      return;
    }

    const componentDestroyList = [];
    clist.forEach((c) => {
      const comp = dmapp.getComponent(c);
      const complayout = this.findComponentInLayout(c, prev);
      if (! isNullOrUndefined(comp)) {
        if (complayout.length === 0) {
          componentDestroyList.push ({
            componentId: c,
            DMAppId: dmapp._id,
            contextId: ctxid,
            stopTime: comp.stopTime,
          });
        } else {
          const layoutTag = "layout";
          const deviceTag = "deviceId";
          const instanceTag = "instanceId";
          complayout.forEach((cc) => {
            componentDestroyList.push ({
              componentId: c,
              DMAppId: dmapp._id,
              contextId: ctxid,
              stopTime: comp.stopTime,
              instanceId: cc[layoutTag][instanceTag],
              deviceId: cc[layoutTag][deviceTag],
            });
          });
        }
      }
    });

    for (const dest in destDevices) {

      this.logr.info(
        Logger.formatMessage("pushing layout destroy to device " + destDevices[dest] + " with components: " +
          JSON.stringify(_.pluck(componentDestroyList, "componentId")), { contextID: ctxid, deviceID: destDevices[dest] }),
      );

      this.ws.pushNotice(ctxid, destDevices[dest], {
        destroy: {
          messageId:  Util.genMessageId(),
          timestamp:  Timestamper.getTimestampNS(),
          deviceId:   destDevices[dest],
          components: componentDestroyList,
        },
      });
    }
  }

  /**
   * send devices notifications of updated components
   * @param db
   * @param contextid
   * @param dmapp
   * @param updatelist - list of updated components to process
   * @param sendIndividualUpdates - send message per update if true
   */
  public notifyComponentsUpdate(db: Database, contextid: string, dmapp: DMApp, updatelist: string[], sendIndividualUpdates: boolean): void {
    /*
     * Push update message for previously laid out / inited components that have had a parameter update.
     * No new layout required...
     *
     * also builds list of component property changes and sends update message.
     */
    updatelist = _.without(updatelist, undefined);
    db.Contexts.get(contextid)
      .then((ctx) => {
        const q = {
          contextId: contextid,
        };

        db.Layouts.findOne(q)
          .then((layout) => {
            const updatedComponents = layout.devices.map((dev: IDeviceLayoutDocument) => {
              // const resolveAsCommunal = ctx.isCommunalDevice(dev.deviceId);
              let comps = dev.components.map((comp: any) => {
                if (updatelist.indexOf(comp.componentId) > -1) {
                  // update params in copy of component held in ctx.layout ...

                  return {  // full component not just id...
                    componentId: comp.componentId,
                    DMAppId: comp.DMAppId,
                    contextId: ctx._id,
                    startTime: comp.startTime,
                    stopTime: comp.stopTime,
                    priorities: dmapp.getResolvedPriorities(ctx, comp, [dev.deviceId]),
                    config: comp.config,
                    layout: comp.layout,
                    parameters: dmapp.getComponent(comp.componentId).parameters,
                  };
                } else {
                  return undefined;
                }
              });
              comps = _.without(comps, undefined);

              if (sendIndividualUpdates) {
                this.ws.pushNotice(contextid, dev.deviceId, {
                  update: {
                    messageId: Util.genMessageId(),
                    timestamp: layout.timestamp,
                    deviceId: dev.deviceId,
                    components: comps,
                  },
                });
              }

              comps = comps.map ((c: any) => { c.deviceId = dev.deviceId; return c; });
              return comps;
            });

            /* reformat to get single list of updated component properties */
            const flattened = [].concat.apply([], updatedComponents);
            const clist = flattened.map ((c) => {
              return {
                componentId: c.componentId,
                DMAppId:     c.DMAppId,
                contextId:   c.contextId,
                deviceId:    c.deviceId,
                priorities:  c.priorities,
              };
            });
            const startedComponents = _.difference (updatelist, _.pluck(clist, "componentId"));
            const others = startedComponents.map ((c) => {
              if (dmapp.getComponent(c) === undefined) {
                this.logr.warn(Logger.formatMessage("notifyComponentsUpdate: undefined component: " + c));
              } else {
                return {
                  componentId: c,
                  DMAppId: dmapp._id,
                  contextId: ctx._id,
                  priorities: dmapp.getResolvedPriorities(ctx, dmapp.getComponent(c), []),
                };
              }
            });
            clist.push.apply(clist, others);

            /* send global component property update */
            this.ws.pushNotice (ctx._id, "componentProperties", {
              componentProperties : {
                messageId: Util.genMessageId(),
                timestamp: Timestamper.getTimestampNS(),
                components: clist,
              },
            });
          });
      });
  }

  /* ---------------------------------------
    * database persistence
    */
  /**
   * save the generated layout to the db
   * @param ctx
   * @param db
   * @param layout
   */
  private persistLayout(ctx, db: Database, layout: GeneratedLayout): Promise<GeneratedLayout> {
    const changeset = {
      $set: {},
    };

    Object.keys(layout).forEach((key) => {
      changeset.$set[ key] = layout[key];
    });

    return db.Layouts.update(
      {_id: ctx._id },
      changeset,
      { upsert: true },
    ).then(() => {
      return layout;
    });
  }

  /* --------------------------------------------------------------------------------
    * push layout notifications
    */

  /**
   * send each device a list of its component update messages
   * @param ctx
   * @param layout
   */
  private notifyUpdate(ctx: Context, layout: GeneratedLayout): void {
    /* send device component list to each device */
    layout.devices.forEach((dev) => {
      const componentlist = dev.components.map((c) => {
        try {
          return ({
              componentId: c.componentId,
              DMAppId: c.DMAppId,
              contextId: ctx._id,
              startTime: c.startTime,
              stopTime: c.stopTime,
              priorities: c.priorities,
              config: c.config,
              layout: c.layout,
              parameters: c.parameters,
          });
        } catch (e) {
          this.logr.error(e);
          this.logr.error(JSON.stringify(c));
        }
      });

      this.logr.info(
        Logger.formatMessage("pushing layout update to devices " + dev.deviceId + " with components: " +
          JSON.stringify(_.pluck(dev.components, "componentId")), { contextID: ctx._id, deviceID: dev.deviceId }));

      this.ws.pushNotice(ctx._id, dev.deviceId, {
          update: {
              messageId: Util.genMessageId(),
              timestamp: layout.timestamp,
              deviceId: dev.deviceId,
              components: componentlist,
          },
      });
    });
  }

  /**
   * notify when a component becomes active
   * @param ctx
   * @param prevLayout
   * @param newLayout
   * @param dmappid
   */
  private notifyCreate(ctx: Context, prevLayout, newLayout, dmappid: string): void {
    // traverse new layout tree looking for started components.
    // if component / device wasnt present at all in previous layout, do an init for that component first...
    newLayout.devices.forEach ((dev) => {
      const deviceId = dev.deviceId;
      const complist = _.filter(dev.components, (c) => {
        return c.startTime != null;
      });

      const ctxLayoutDev = prevLayout == null ? null : prevLayout.devices.find ((d) => d.deviceId === deviceId);
      if (ctxLayoutDev == null) { // this device wasn't present on last layout!
          // do an init on all components for that device
        const components = complist.map((comp) => {
          return ({
            contextId: ctx._id,
            DMAppId: dmappid,
            componentId: comp.componentId,
            config: comp.config,
            priorities: comp.priorities,
            startTime: null,
            stopTime: null,
            layout: {
              instanceId: Util.componentInstanceId (ctx._id, dmappid, deviceId , comp.componentId),
            },
            parameters: comp.parameters,
          });
        });
        this.logr.info(
          Logger.formatMessage("new device in context; sending push create for laid out components: " +
            _.pluck(components, "componentId"), {contextID: ctx._id}));

        this.ws.pushNotice(ctx._id, dev.deviceId, {
            create: {
                messageId: Util.genMessageId(),
                timestamp: newLayout.timestamp - 100000000,
                deviceId:  dev.deviceId,
                components,
            },
        });
      } else { // device existed before
        // look for component in previous layout - if not found, init
        const components = [];
        complist.forEach((comp) => {
          if (isNullOrUndefined(ctxLayoutDev.components.find((e) => e.componentId === comp.componentId))) {
            components.push ({
              contextId: ctx._id,
              DMAppId: dmappid,
              componentId: comp.componentId,
              config: comp.config,
              priorities: comp.priorities,
              startTime: comp.startTime,
              stopTime: comp.stopTime,
              layout: {
                instanceId: Util.componentInstanceId (ctx._id, dmappid, deviceId , comp.componentId),
              },
              parameters: comp.parameters,
            });
          }
        });

        if (components.length > 0) {
          this.logr.info(
            Logger.formatMessage("sending push create for components not previously inited for this device: " +
              _.pluck(components, "componentId"), {contextID: ctx._id, deviceId: dev.deviceId}));

          this.ws.pushNotice(ctx._id, dev.deviceId, {
            create: {
              messageId: Util.genMessageId(),
              timestamp: newLayout.timestamp - 100000000,
              deviceId:  dev.deviceId,
              components,
            },
          });
        }
      }
    });
  }

  /**
   * correctly mark newly initialized but not started components
   * @param ctx
   * @param prevLayout
   * @param newLayout
   * @param dmapp
   */
   private manageInitedComps(ctx: Context, prevLayout, newLayout: GeneratedLayout, dmapp: DMApp): GeneratedLayout {
    if (isNullOrUndefined(prevLayout)) {
      return newLayout;
    }
    // iterate previous layout looking for init'ed components (startTime null)
    // if they are not found in new layout, merge them before overwriting layout...

    prevLayout.devices.forEach ((dev) => {
      const deviceId = dev.deviceId;
      const complist = _.filter(dev.components, (c) => {
        return c.startTime == null;
      });
      this.logr.debug(Logger.formatMessage("previously inited components: " + _.pluck(complist, "componentId"),
        {contextID: ctx._id, dmappID: dmapp._id}));

      // iterate list...
      complist.forEach ((comp) => {
        const targetDev = _.findWhere(newLayout.devices, {deviceId});
        if (targetDev !== undefined) {

          // look for component in valueDev - if not found, copy over
          if (_.findWhere(targetDev.components, {componentId: comp.componentId}) === undefined) {
            this.logr.debug(Logger.formatMessage("carrying over inited component: " + comp.componentId + " on device: " + deviceId,
              {contextID: ctx._id, dmappID: dmapp._id, dmappcID: comp.componentId}));
            comp.DMAppId = dmapp._id; // this isnt persisted in layout on init...
            targetDev.components.push(comp) ;
          }
        }
      }) ;
    });

    return newLayout;
   }

  /**
   * Need to make sure that components which are skipped having been previously laid out (e.g. due to having priority set to zero)
   * are maintained in the device layout but with layout taking zero space. This achieves two things:
   * 1/ makes sure that the client gets a push notification for the hidden / skipped component (otherwise it wont update it's presentation)
   * 2/ makes sure that a hidden / skipped component will still get cleaned up properly on transaction stop etc.
   * NB in current implementation:
   * components skipped with priority == 0 will report as status 'skipped'
   * components skipped with priority > 0 will repost as 'incompatible'
   *
   * @param ctx
   * @param prevLayout
   * @param newLayout
   * @param dmapp
   */
   private manageHiddenComps(ctx: Context, prevLayout, newLayout: GeneratedLayout, dmapp: DMApp): GeneratedLayout {
    if (isNullOrUndefined(prevLayout)) {
      return newLayout;
    }

    newLayout.notPlaced.forEach ((np) => {
      if ((np.status === "incompatible") || (np.status === "skipped")) {
        np.components.forEach((compId) => {
          prevLayout.devices.forEach ((dev) => {
            const comp = dev.components.find ((c) => c.componentId === compId);
            if (comp && ctx.hasDevice(dev.deviceId)) {
              // &&
              // ((np.group.startsWith("communal") && ctx.isCommunalDevice(dev.deviceId)) ||
              // (np.group.startsWith("personal") && !ctx.isCommunalDevice(dev.deviceId)))) { // we still have the device...
              // prep component
              const latestComp: IComponentDocument = dmapp.getComponent(comp.componentId) ;
              if ((comp.componentId === compId) && (latestComp != null) && (latestComp.stopTime == null) &&
                 (comp.startTime != null) && (comp.layout.size)) {
                // if started but not stopped, persist into new layout on same device, but with empty layout object
                const newComp: any = latestComp ;
                newComp.DMAppId = dmapp._id;
                newComp.contextId = ctx._id;
                newComp.layout = {
                  size: {
                    width: -1,
                    height: -1,
                  },
                  position: {
                    x: 0,
                    y: 0,
                  },
                  deviceId: dev.deviceId,
                  instanceId: Util.componentInstanceId (ctx._id, dmapp._id, dev.deviceId , compId),
                } ;
                // do we have device in layout?
                const targetDev = newLayout.devices.find((d) => d.deviceId === dev.deviceId);
                if (targetDev) {
                  let targetComp = targetDev.components.find ((c) => c.componentId === compId);
                  if (targetComp) {
                    targetComp = newComp ;
                  } else {
                    targetDev.components.push(newComp);
                  }
                } else { // didnt find targetdev, so insert
                  newLayout.devices.push({
                    deviceId: dev.deviceId,
                    components: [newComp],
                  });
                }
                this.logr.info(Logger.formatMessage("carrying over " + np.status + " component with 'empty' layout: " + newComp.componentId
                  + " on device: " + dev.deviceId, {contextID: ctx._id, dmappcID: newComp.componentId}));
              }
            }
          });
        });
      }
    });

    return newLayout;
  }

  /**
   * pluck all occurrances of a component from a layout
   * @param cid
   * @param layout
   */
  private findComponentInLayout(cid: string, layout: Layout): any[] {
    const res = [];
    layout.devices.forEach((dev) => {
      dev.components.forEach((c) => {
        if (c.componentId === cid) {
          res.push(c);
        }
      });
    });
    return res;
  }
}
