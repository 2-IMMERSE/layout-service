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
import { Context } from "../model/Context";
import { DMApp } from "../model/DMApp";
import { ILayoutDocument, Layout } from "../model/Layout";
import { SocketClient } from "../SocketClient";
import { Util } from "../Util";
import { LayoutGenerator } from "./LayoutGenerator";
import { GeneratedLayout } from "./LayoutManager";

/**
 * layout simulation
 * runs the layout generation but does not commit result.
 * used when components are initialized but not yet started to determine
 * upon which devices they will be laid out.  these devices then receive
 * advance notice so that they can preload anything that may be necessary
 */

export class LayoutSimulator {
  private logr: log4js.Logger;
  private generator: LayoutGenerator;

  constructor(private ws: SocketClient ) {
    this.logr = log4js.getLogger("layout");
    this.generator = new LayoutGenerator();
  }

  /**
   * run a layout simulation, and store the results
   * @param db
   * @param ctx
   * @param dmapp
   * @param initlist
   */
  public runSimulation( db: Database, ctx: Context,  dmapp: DMApp,  initlist: string[]): Promise<GeneratedLayout> {
    return new Promise<GeneratedLayout>((resolve, _reject) => {
      dmapp.showComponents(initlist)
        .then (() => {
          this.generator.genLayout(ctx, db)
            .then((newlayout: GeneratedLayout) => {
              dmapp.hideComponents(initlist);
              const newComponentList = this.notifyNewComponents(newlayout, dmapp, initlist);
              this.persistSimulation(newComponentList, ctx, db, newlayout.timestamp)
                .then (() => resolve(newlayout));
            });
        });
    });
  }

  /**
   * send out messages for newly active components
   * @param layout
   * @param dmapp
   * @param initList
   */
  private notifyNewComponents(layout ,  dmapp: DMApp, initList): object {
    const components = {};

    layout.devices.forEach((dev) => {
      const complist = [];

      dev.components.forEach((comp) => {
        if (initList.find((c) => (c === comp.componentId))) {
          complist.push({
            contextId: dmapp.contextId,
            DMAppId: dmapp._id,
            componentId: comp.componentId,
            constraintId: comp.constraintId,
            config: comp.config,
            startTime: null,
            stopTime: null,
            layout: {
              instanceId: comp.layout.instanceId,
            },
            parameters: dmapp.getComponent(comp.componentId).parameters,
          });
        }
      });
      if (complist.length > 0) {
        this.ws.pushNotice(dmapp.contextId, dev.deviceId, {
          create: {
            messageId: Util.genMessageId(),
            timestamp: layout.timestamp,
            deviceId: dev.deviceId,
            components: complist,
          },
        });
        components[dev.deviceId] = complist;
        this.logr.info(
          Logger.formatMessage("pushing component create to devices " + dev.deviceId + " with components: " +
            JSON.stringify(_.pluck(complist, "componentId")), {
              contextID: dmapp.contextId,
            }));
      }
    });

    return components;
  }

  /**
   * store the results
   * persist layout simulation results version to make sure we have push msg / REST equivalence...
   * newly created components that are not yet started are appended to the layout with the deviceId of the device
   * is it projected to be laid out on, but with no layout position or size,
   * @param newComponentList
   * @param ctx
   * @param db
   * @param ts
   */
  private persistSimulation(newComponentList: object, ctx: Context, db: Database, ts: number): Promise<Layout> {
    return new Promise<Layout>((resolve, _reject) => {
      db.Layouts.findOne(ctx._id)
        .then((layout) => {
          const now = new Date ();
          if (! isNullOrUndefined(layout)) {
            for (const dev in newComponentList) {
              newComponentList[dev].forEach((comp) => {
                let devlayout = layout.devices.find ((d) => d.deviceId === dev);
                if (isNullOrUndefined(devlayout))  {
                  layout.devices.push({deviceId: dev, components: []}) ;
                  devlayout = layout.devices.find ((d) => d.deviceId === dev);
                }
                const c = devlayout.components.find((e) => e.componentId === comp.componentId);
                if (isNullOrUndefined(c)) {
                  devlayout.components.push({
                    componentId: comp.componentId,
                    constraintId: comp.constraintId,
                    config: comp.config,
                    parameters: comp.parameters,
                    startTime: null,
                    stopTime: null,
                    layout: {
                      instanceId: comp.layout.instanceId,
                    },
                  });
                }
              });
            }
            layout.updatedAt = now;
            layout.save().then((l) => resolve(l));
          } else {
            const devlist = [];
            for (const dev in newComponentList) {
              const complist = [];
              newComponentList[dev].forEach((comp) => {
                   complist.push({
                      componentId: comp.componentId,
                      constraintId: comp.constraintId,
                      config: comp.config,
                      parameters: comp.parameters,
                      startTime: null,
                      stopTime: null,
                      layout: {
                        instanceId: comp.layout.instanceId,
                      },
                  });
                });
              devlist.push ({ deviceId: dev, components: complist });
            }
            const _layout: ILayoutDocument = {
              devices: devlist,
              timestamp: ts,
              updatedAt: now,
          };
            _layout._id = ctx._id;
            db.Layouts.insert (_layout).then((l) => resolve(l));
          }
        });
    });
  }
}
