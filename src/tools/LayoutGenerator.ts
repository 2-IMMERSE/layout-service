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
import { IConstraintConfigDocument } from "../model/Constraint";
import { Context, IGroupDocument } from "../model/Context";
import { Device, IDeviceDocument } from "../model/Device";
import { DMApp } from "../model/DMApp";
import { Timestamper } from "../Timestamper";
import { Util } from "../Util";
import { GeneratedLayout, Skipped } from "./LayoutManager";
import { LayoutPacker } from "./LayoutPacker";
import { PackerRegion, PackerUtils, Packing} from "./PackerUtils";

/**
 * generate a new layout
 * maps db data into structures to be fed into the engine
 * runs the engine
 * formats data to be returned
 */

/* internal structure */
class ContextLayout {
    public ctx: Context;
    public devices: any[];
    public notPlaced: Skipped[];
    public noDevice: string[];
}

export class LayoutGenerator {
  private logr: log4js.Logger;
  private packer: LayoutPacker;

  constructor() {
    this.logr = log4js.getLogger("layout");
    this.packer = new LayoutPacker();
  }

  /* ------------------------------
   * class utilities
   */

  /**
   * convert layout sizes from pixels to percentages
   * @param ctx
   * @param layout
   */
  private static convertLayoutToPercentages(ctx: Context, layout: ContextLayout): ContextLayout {
    layout.devices.forEach ((dev) => {
      const device = ctx.getDevice(dev.deviceId);
      const devHeight = device.caps.displayHeight;
      const devWidth = device.caps.displayWidth;
      dev.components.forEach ((comp) => {
        if (comp.hasOwnProperty("layout")) {
          let height = devHeight ;
          let width = devWidth ;
          if ((comp.layout.hasOwnProperty("regionId")) && (comp.layout.regionId != null)) {
            device.regions.forEach((region) => {
              if (region.regionId === comp.layout.regionId) {
                width = region.displayWidth;
                height = region.displayHeight;
              }
            });
          }
          if ((comp.layout.hasOwnProperty("size")) && (comp.layout.size.hasOwnProperty("width")) &&
              (typeof comp.layout.size.width === "number")) {
              comp.layout.size.width = (100.0 * comp.layout.size.width / width).toString() + "%" ;
          }
          if ((comp.layout.hasOwnProperty("size")) && (comp.layout.size.hasOwnProperty("height")) &&
              (typeof comp.layout.size.height === "number")) {
              comp.layout.size.height = (100.0 * comp.layout.size.height / height).toString() + "%" ;
          }
          if ((comp.layout.hasOwnProperty("position")) && (comp.layout.position.hasOwnProperty("x")) &&
              (typeof comp.layout.position.x === "number")) {
              comp.layout.position.x = (100.0 * comp.layout.position.x / width).toString() + "%" ;
          }
          if ((comp.layout.hasOwnProperty("position")) && (comp.layout.position.hasOwnProperty("y")) &&
              (typeof comp.layout.position.y === "number")) {
              comp.layout.position.y = (100.0 * comp.layout.position.y / height).toString() + "%" ;
          }
        }
      });
    });
    return layout ;
  }

  /**
   * force integer return values when returning pixels
   * @param ctx
   * @param layout
   */
  private static truncateLayoutSizes(ctx: Context, layout: ContextLayout): ContextLayout {
    layout.devices.forEach ((dev) => {
      const device = ctx.getDevice(dev.deviceId);
      const devHeight = device.caps.displayHeight;
      const devWidth = device.caps.displayWidth;
      dev.components.forEach ((comp) => {
        if (comp.hasOwnProperty("layout")) {
          let height = devHeight ;
          let width = devWidth ;
          if ((comp.layout.hasOwnProperty("regionId")) && (comp.layout.regionId != null)) {
            device.regions.forEach((region) => {
              if (region.regionId === comp.layout.regionId) {
                width = region.displayWidth;
                height = region.displayHeight;
              }
            });
          }
          if ((comp.layout.hasOwnProperty("size")) && (comp.layout.size.hasOwnProperty("width")) &&
            (typeof comp.layout.size.width === "number")) {
            comp.layout.size.width = Math.round(comp.layout.size.width);
          }
          if ((comp.layout.hasOwnProperty("size")) && (comp.layout.size.hasOwnProperty("height")) &&
            (typeof comp.layout.size.height === "number")) {
            comp.layout.size.height = Math.round(comp.layout.size.height);
          }
          if ((comp.layout.hasOwnProperty("position")) && (comp.layout.position.hasOwnProperty("x")) &&
            (typeof comp.layout.position.x === "number")) {
            comp.layout.position.x = Math.round(comp.layout.position.x);
          }
          if ((comp.layout.hasOwnProperty("position")) && (comp.layout.position.hasOwnProperty("y")) &&
            (typeof comp.layout.position.y === "number")) {
            comp.layout.position.y = Math.round(comp.layout.position.y);
          }
        }
      });
    });
    return layout ;
  }

  /**
   * get DMApps from the database and run the layout against them
   * @return GeneratedLayout
   * @param ctx
   * @param db
   */
  public genLayout(ctx: Context, db: Database): Promise<GeneratedLayout> {
    return new Promise<GeneratedLayout>((resolve, _reject) => {
      const q = [];
      q.push({ $match: { contextId: ctx._id }});
      db.DMApps.aggregate(q)
        .then((aggs) => {
          const dmapps = [];
          if (aggs) {
            aggs.forEach((data: DMApp) => {
              dmapps.push(new db.DMApps.Instance(data));
            });
          }

          const layout = this.computeLayout(ctx, dmapps);
          this.dumpLayout (layout);

          resolve ({
            contextId: ctx._id,
            devices: layout.devices,
            notPlaced: layout.notPlaced,
            timestamp: Number(Timestamper.getTimestampNS()),
          });
        });
    });
  }

  /**
   * run the layout for each group of devices in a context
   * @return compilation of the resulting layouts
   * @param ctx
   * @param dmapps
   */
  public computeLayout(ctx: Context, dmapps: DMApp[]): ContextLayout {
    // implementing only the packer algorithm for now
    let layout: ContextLayout = {
      ctx,
      devices: [],
      noDevice: [],
      notPlaced: [],
    };

    /* layout over the set of devices in each device group */
    const groups: [IGroupDocument] = ctx.getDeviceGroups();
    groups.forEach ((group) => {
        const devicelist = ctx.getGroupDevices(group.id);
        layout = this.runLayout(ctx, dmapps, layout, devicelist, group.id, group.type);
    });

    return (layout);
  }

  /**
   * runs the layout algorithm for a group of devices
   * first builds rectangle list from the component definitions and the region list from the device defintions
   * @return a layout
   * @param ctx
   * @param dmapps
   * @param layout
   * @param devicelist
   * @param groupname
   * @param grouptype
   */
  private runLayout(ctx: Context,
                    dmapps: DMApp[],
                    layout: ContextLayout,
                    devicelist: string[],
                    groupname: string,
                    grouptype: string): ContextLayout  {

    /* generate the list of regions */
    const regions: PackerRegion[] = this.buildRegionNodeTree(ctx, devicelist);
    if (regions.length === 0) {
      return (layout);
    }

    /* generate the list of components */
    const clist = this.buildComponentList(ctx, dmapps, devicelist, regions, grouptype);
    if (clist.componentlist.length === 0) {
      if (clist.allIds.length > 0) {
        layout.notPlaced.push({group: groupname, status: "incompatible", components: clist.allIds});
      }
      return (layout);
    }

    let nodevice: string [] = _.difference(clist.allIds, _.pluck(clist.componentlist, "componentId"));

    /* run the algorithm */
    const packed: Packing = this.packer.packRegions(regions, clist.componentlist, grouptype === "mixed");

    nodevice = _.union(nodevice, packed.noDevice);
    if (nodevice.length > 0) {
      layout.notPlaced.push({
        group: groupname,
        status: "incompatible",
        components: nodevice,
      });
    }

    if (packed.notPlaced.length > 0) {
      layout.notPlaced.push({
          group: groupname,
          status: "skipped",
          components: packed.notPlaced,
      });
    }

    if (packed.layout.length === 0) {
      return (layout);
    }

    /* update component layouts with new layout */
    const skipped = [];
    const groupLayout = {};

    /* parse the received component centric layout */
    packed.layout.forEach((c) => {
      const dmapp = dmapps.find((search) => (search._id === c.DMAppId));
      const component  = Util.clone(dmapp.getComponent(c.componentId));
      const componentConstraints =
        (grouptype === "mixed" && !ctx.getDevice(c.deviceId).caps.communalDevice)
        ? c.personalconstraints
        : c.constraints;

      component.DMAppId = dmapp._id;
      component.contextId = ctx._id;
      component.layout.size = {
        width: c.width - 2 * componentConstraints.margin,
        height: c.height - 2 * componentConstraints.margin,
      };
      component.layout.position = {
        x: c.x0 + componentConstraints.margin,
        y: c.y0 + componentConstraints.margin,
      };
      component.layout.priority = componentConstraints.priority;
      component.layout.deviceId = c.deviceId;
      component.layout.regionId = c.regionId != null ? c.regionId : c.deviceId;
      component.layout.timestamp = Timestamper.getTimestampNS();
      component.layout.mode = componentConstraints.prefSize.mode;
      if (component.layout.deviceId != null) {
          if (!groupLayout.hasOwnProperty(component.layout.deviceId)) {
              groupLayout[component.layout.deviceId] = [];
          }
          groupLayout[component.layout.deviceId].push(component);
      } else {
        /* list of components that were not placed due to lack of room */
        skipped.push(c.componentId);
      }
    });

    /* compose device centric layout */
    for (const dev in groupLayout) {
        layout.devices.push({
          deviceId: dev,
          components: groupLayout[dev],
        });
    }

    /* record skipped components */
    if (skipped.length > 0) {
      layout.notPlaced.push({group: groupname, status: "skipped", components: skipped});
    }

    return this.postProcess(ctx, layout);
  }

  /**
   * convert output data to requested units
   * @param ctx
   * @param layout
   */
  private postProcess(ctx: Context, layout: ContextLayout): ContextLayout {
    // JGW: quick implementation of component instance id's... Need to make robust to component device moves...
    layout.devices.forEach ((dev) => {
      dev.components.forEach ((comp) => {
        comp.layout.instanceId = Util.componentInstanceId (ctx._id , comp.DMAppId , comp.layout.deviceId , comp.componentId) ;

        // JGW: quick fix to purge regionId == deviceId, one may be null, do not use ===
        if (comp.layout.deviceId === comp.layout.regionId) {
            comp.layout.regionId = null ;
        }
      });
    });

    if (!isNullOrUndefined(ctx.config) && ctx.config.hasOwnProperty("percentCoords") && ctx.config.percentCoords) {
      this.logr.debug(Logger.formatMessage("converting Layout To Percentages"));
      layout = LayoutGenerator.convertLayoutToPercentages(ctx, layout);
    } else {
      layout = LayoutGenerator.truncateLayoutSizes(ctx, layout);
    }

    return layout;
  }

  /**
   * build the list of regions onto which the components will be laid out
   * @return a list of packing regions
   * @param ctx
   * @param devices
   */
  private buildRegionNodeTree(ctx: Context, devices: string[]): PackerRegion[] {
    /* create root node per device */
    const devNodes: PackerRegion[] = [];
    devices.forEach ((dev) => {
      const device: IDeviceDocument = ctx.getDevice(dev);
      if (!device.regions || device.regions.length < 1) {
        devNodes.push ({
          x0: 0,
          y0: 0,
          cid: null,
          child1: null,
          child2: null,
          width: device.caps.displayWidth,
          height: device.caps.displayHeight,
          dpi:  device.caps.displayResolution,
          deviceId: dev,
          regionId: dev,
          boundingWidth: device.caps.displayWidth,
          boundingHeight: device.caps.displayHeight,
          maxVideo: device.caps.concurrentVideo,
          maxAudio: device.caps.concurrentAudio,
          suitable: true,
          communal: device.caps.communalDevice,
        });
      } else {
        device.regions.forEach ((r) => {
          devNodes.push ({
            x0: 0,
            y0: 0,
            cid: null,
            child1: null,
            child2: null,
            width: r.displayWidth,
            height: r.displayHeight,
            dpi:  device.caps.displayResolution,
            deviceId: dev,
            regionId: r.regionId,
            boundingWidth: r.displayWidth,
            boundingHeight: r.displayHeight,
            maxVideo: device.caps.concurrentVideo,
            maxAudio: device.caps.concurrentAudio,
            suitable: true,
            communal: device.caps.communalDevice,
          });
        });
      }
    });

    return devNodes;
  }

  /**
   * build the list of visible components that will be laid out
   * @param ctx
   * @param dmapps
   * @param devicelist
   * @param regions
   * @param grouptype
   */
  private buildComponentList(ctx: Context, dmapps: DMApp[], devicelist: string[], regions: any[], grouptype: string): any {
    const componentlist = [];
    const allids = [];

    const device = ctx.getDevice(devicelist[0]);

    dmapps.forEach((dmapp) => {
        const components = this.getPrioritizedComponentList(dmapp, device, grouptype);

        components.forEach((c) => {
          const comconstraints = c.constraints;
          const validregions = [];

          regions.forEach((dev) => {
            if (Device.meetConstraints(ctx.getDevice(dev.deviceId), comconstraints)) {
              if (comconstraints.hasOwnProperty("targetRegions")) {
                if (_.contains(comconstraints.targetRegions, dev.regionId)) {
                  validregions.push(dev.regionId);
                }
              } else if (!_.contains(validregions, dev.regionId)) {
                validregions.push(dev.regionId);
              }
            }
          });

          /* if group is monolithic, i.e. comprised entirely of communal or personal devices, we maintain
           * a single set of constraints to use while laying out.
           * if the group has both communal and personal devices , it is termed a "mixed" group and
           * the component contains the communal constraints + the personal constraints stored in personalconstraints.
           */
          let personal = null;
          if (grouptype === "mixed") {
            personal = c.personalconstraints;
            personal._aspect = this.getAspect(personal);
            personal.prefSize = this.getPrefSize (c, personal);
            personal.margin = personal.hasOwnProperty("margin") ? personal.margin : 0;
            personal.dependencies
              = personal.hasOwnProperty("componentDependency") ? personal.componentDependency : [];
            personal.priority = dmapp.resolvePriority(c, device, false);
            personal.valid = [];
            regions.forEach((dev) => {
              if (Device.meetConstraints(ctx.getDevice(dev.deviceId), personal)) {
                if (personal.hasOwnProperty("targetRegions")) {
                  if (_.contains(personal.targetRegions, dev.regionId)) {
                    personal.valid.push(dev.regionId);
                  }
                } else if (!_.contains(validregions, dev.regionId)) {
                  personal.valid.push(dev.regionId);
                }
              }
            });
          }

          comconstraints.prefSize = this.getPrefSize(c, comconstraints);
          comconstraints.priority = dmapp.resolvePriority(c, device, grouptype === "mixed" ? true : device.caps.communalDevice);
          comconstraints.valid = validregions;
          if (! comconstraints.hasOwnProperty("margin")) {
            comconstraints.margin = 0;
          }
          comconstraints._aspect = this.getAspect(comconstraints);
          comconstraints.dependencies
            = comconstraints.hasOwnProperty("componentDependency") ? comconstraints.componentDependency : [];

          const visible = ((!c.layout.hasOwnProperty("visible")) || c.layout.visible === true) && (comconstraints.priority > 0);
          if (validregions.length > 0 && visible) {
            componentlist.push({
              componentId: c.componentId,
              DMAppId: dmapp._id,
              contextId: ctx._id,
              constraints: comconstraints,
              personalconstraints: personal,
              config: c.config,
              parameters: c.parameters,
              startTime: c.startTime,
              stopTime: c.stopTime,
              layout: c.layout,
            });
          }

          allids.push(c.componentId);
        });
      });

    const clist  = componentlist.sort((a, b) => {
      const pa: number = a.constraints.priority;
      const pb: number = b.constraints.priority;
      if (pa < pb) {
        return 1;
      }
      if (pa > pb) {
        return -1;
      }
      const r = PackerUtils.largerEqual(PackerUtils.rectSize(a.constraints, regions[0]), PackerUtils.rectSize(b.constraints, regions[0]));
      if (r !== 0) {
        return r;
      }
      const anchorA = a.constraints.anchor;
      const anchorB = b.constraints.anchor;
      if (isNullOrUndefined(anchorB)) {
        return 1;
      }
      if (isNullOrUndefined(anchorA)) {
        return -1;
      }
      if (_.contains(anchorA, "top")) {
        return -1;
      }
      if (_.contains(anchorB, "top")) {
        return 1;
      }
      if (_.contains(anchorA, "right")) {
        return -1;
      }
      if (_.contains(anchorB, "right")) {
        return 1;
      }
      if (_.contains(anchorA, "left")) {
        return -1;
      }
      if (_.contains(anchorB, "left")) {
        return 1;
      }
      if (_.contains(anchorA, "bottom")) {
        return -1;
      }
      if (_.contains(anchorB, "bottom")) {
        return 1;
      }
      return -1;
    });

    return ({
      componentlist: clist,
      allIds: allids,
    });
  }

  /**
   * @return aspect ratio specified in the constraints as a float
   * if no aspect ratio is specified return 0
   * @param constraints - component constraint to be used in this computation
   */
  private getAspect(constraints: IConstraintConfigDocument): number {
    if (constraints == null || !constraints.hasOwnProperty("aspect")) {
      return PackerUtils.noAspect;
    }

    const dim = constraints.aspect.split(":");

    return parseFloat(dim[1]) / parseFloat(dim[0]);
  }

  /**
   * @return the preferred lay out size
   * @param c - the component
   * @param constraints - the component's constraint set
   */
  private getPrefSize(c: IComponentDocument , constraints: IConstraintConfigDocument): object {
    if (c.hasOwnProperty("prefSize")) {
      return c.prefSize;
    }

    return constraints.hasOwnProperty("prefSize") ? constraints.prefSize : PackerUtils.defaultPrefSize;
  }

  /**
   * @return list of components ordered by priority as defined by the dmapp constraints
   * @param dmapp
   * @param device
   * @param grouptype
   */
  private getPrioritizedComponentList(dmapp: DMApp, device: IDeviceDocument, grouptype: string): any[] {
    const components = Util.clone(dmapp.getComponentList());

    components.forEach((c) => {
      if (grouptype === "mixed") {
        c.constraints = Util.clone(dmapp.getComponentConstraints(c.constraintId, true));
        c.personalconstraints = Util.clone(dmapp.getComponentConstraints(c.constraintId, false));
      } else {
        c.constraints = Util.clone(dmapp.getComponentConstraints(c.constraintId, device.caps.communalDevice));
      }
    });

    if (components.length < 2) {
      return components;
    }

    const box = {
      boundingWidth: device.caps.displayWidth,
      boundingHeight: device.caps.displayHeight,
      dpi: device.caps.displayResolution,
    };

    return components.sort((a, b) => {
       const priorityA = dmapp.getPriority(a, device, "personal");
       const priorityB = dmapp.getPriority(b, device, "personal");

       if (priorityA < priorityB) {
           return 1;
       }

       if (priorityA > priorityB) {
           return -1;
       }

       return b.constraints == null
        ? 1 : (a.constraints == null)
          ? -1 : a.constraints.hasOwnProperty("anchor")
            ? 1 : b.constraints.hasOwnProperty("anchor")
              ? -1 : Util.isLarger (PackerUtils.toPixelResolution(a.constraints.minSize, PackerUtils.minRect, box),
                PackerUtils.toPixelResolution(b.constraints.minSize, PackerUtils.minRect, box));
    });
  }

  private dumpLayout(layout: ContextLayout): void {
    this.logr.debug(Logger.formatMessage("--------------------------------------------"));
    this.logr.debug(Logger.formatMessage("computeLayout returning layout: " + JSON.stringify(layout)));

    layout.devices.forEach((device) => {
      this.logr.debug(Logger.formatMessage("laid out components for device: " + device.deviceId + ": " +
        JSON.stringify(_.pluck(device.components, "componentId"))));
      this.logr.debug(Logger.formatMessage("layout for device " + device.deviceId + ": " + JSON.stringify(device)));
    });

    this.logr.debug(Logger.formatMessage("no device found for components: " + JSON.stringify(layout.noDevice)));
    this.logr.debug(Logger.formatMessage("skipped components: " + JSON.stringify(layout.notPlaced)));
  }
}
