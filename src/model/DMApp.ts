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
import * as Iridium from "iridium";
import { isNullOrUndefined } from "util";
import { Globals } from "../globals";
import { Timestamper } from "../Timestamper";
import { Util } from "../Util";
import { Component, componentSchema, IComponentConstraint, IComponentDocument } from "./Component";
import { constraintSchema, IConstraintConfigDocument, IConstraintDocument } from "./Constraint";
import { Context} from "./Context";
import { IDeviceDocument } from "./Device";
import { ITemplateDocument, templateSchema } from "./Template";

/**
 * distributed media application (DMApp) data definition
 * database view
 */

interface ISpecDocument {
  timelineDocUrl: string;
  layoutReqsUrl: string;
}

const specSchema = {
  timelineDocUrl: String,                 /* pass thru data */
  layoutReqsUrl: String,                  /* layout constraints */
};

export interface IDMAppDocument {
  _id?: string;                         /* internal dmapp id */
  contextId: string;                    /* context to which dmapp belongs */
  spec: ISpecDocument;                  /* constraints URL */
  components: IComponentDocument[];     /* list of initialized or started components */
  constraints: IConstraintDocument[];   /* actual constraints */
  templates: ITemplateDocument[];       /* templated constraints -- obsolete */
  layoutModel: string;                  /* algorithm -- must be "packer" */
  updatedAt: Date;                      /* time dmapp was last updated */
  timestamp: number;                    /* timestamp of last layout computation */
}

@Iridium.Index({ _id: 1 })
@Iridium.Index({ contextId: 1 })
@Iridium.Index({ updatedAt: 1 }, { expireAfterSeconds: 518000 })
@Iridium.Index({ "components.componentId": 1 }, { sparse: true })
@Iridium.Index({ "constraints.constraintId": 1 }, { sparse: true })
@Iridium.Collection("dmapps")
export class DMApp extends Iridium.Instance<IDMAppDocument, DMApp> implements IDMAppDocument {
  @Iridium.ObjectID
  public _id: string;

  @Iridium.Property(specSchema)
  public spec: ISpecDocument;

  @Iridium.Property(String)
  public contextId: string;

  @Iridium.Property([componentSchema])
  public components: IComponentDocument[];

  @Iridium.Property([constraintSchema])
  public constraints: IConstraintDocument[];

  @Iridium.Property([templateSchema])
  public templates: ITemplateDocument[];

  @Iridium.Property(String)
  public layoutModel: string;

  @Iridium.Property(Date)
  public updatedAt: Date;

  @Iridium.Property(Number)
  public timestamp: number;

  public static onCreating(doc: IDMAppDocument) {
    doc.components = doc.components || [];
    doc.constraints = doc.constraints || [];
    doc.templates = doc.templates || [];
    doc.layoutModel = doc.layoutModel || "packer";
    doc.updatedAt = new Date();
    doc.timestamp = Timestamper.getTimestampNS();
  }

  public static onSaving(instance: DMApp, _changes: Iridium.Changes) {
    instance.updatedAt = new Date();
  }

  /**
   * given a constraint id, return either the communal or personal constraint specification
   * @param constraintId - id of the constraint to be returned
   * @param communal - true if want communal constraints, otherwise returns personal constraint
   * @return - constraint specification
   */
  public getComponentConstraints(constraintId: string, communal: boolean): IConstraintConfigDocument {
    let constraints: IConstraintDocument[];

    constraints = this.select(this.constraints, (c) => c.constraintId === constraintId);

    if (constraints.length === 0) {
      return Globals.defaultComponentConstraint;
    }

    if (! constraints[0].communal.hasOwnProperty ("minSize")) {
      constraints[0].communal.minSize = Globals.absoluteMinSize;
    }

    if (! constraints[0].personal.hasOwnProperty ("minSize")) {
      constraints[0].personal.minSize = Globals.absoluteMinSize;
    }

    return communal ? constraints[0].communal : constraints[0].personal;
  }

  /**
   * given a constraint id, return communal and personal constraint specifications
   * @param constraintId - id of the constraint to be returned
   * @return - full constraint specification
   */
  public getConstraint(constraintId: string): IConstraintDocument {
    let constraints: IConstraintDocument[];

    constraints = this.select(this.constraints, (c) => c.constraintId === constraintId);

    if (constraints.length === 0) {
      return {
        constraintId: Globals.defaultConstraintId,
        communal: Globals.defaultComponentConstraint,
        personal: Globals.defaultComponentConstraint,
      };
    }

    return constraints[0];
  }

  /**
   * given a component id, return the component with its current state
   * @param id - id of the constraint to be returned
   * @return - component
   */
  public getComponent(id: string): IComponentDocument {
    const c = this.select(this.components, (comp) => comp.componentId === id);

    return c.length > 0 ? c[0] : undefined;
  }

  /**
   * retrieve list of components
   * @return - all active components in this dmapp
   */
  public getComponentList(): any {
    return this.components;
  }

  /*
   * @param component - add the component to this dmapp
   */
  public addComponent(component: IComponentDocument) {
    this.components.push(component);
  }

  /**
   * add a new constraint
   * @param constraint - add the constraint to this dmapp
   */
  public addConstraint(constraint: IConstraintDocument) {
    if (! constraint.communal.hasOwnProperty ("minSize")) {
      constraint.communal.minSize = Globals.absoluteMinSize;
    }

    if (! constraint.personal.hasOwnProperty ("minSize")) {
      constraint.personal.minSize = Globals.absoluteMinSize;
    }

    this.constraints.push(constraint);
  }

  /**
   * remove a constraint
   * @param id - remove constraint with constraintId=id from the dmapp
   */
  public removeConstraint(id: string): Promise<DMApp> {
    return this.save({
      $pull: {
        constraints: {
          constraintId: { $eq: id },
        },
      },
    });
  }

  public initComponent(cc: IComponentConstraint, config: any, params: any): IComponentDocument {
    let component = this.getComponent(cc.componentId);

    if (!component) {
      component = new Component();

      component.componentId = cc.componentId;

      if (cc.constraintId) {
        if (this.select(this.constraints, (c) => c.constraintId === cc.constraintId).length === 0) {
          component.constraintId = Globals.defaultConstraintId;
        } else {
          component.constraintId = cc.constraintId;
        }
      } else {
        component.constraintId = Globals.defaultConstraintId;
      }

      component.config = config;
      component.parameters = params;
      component.layout = Util.clone(Globals.defaultComponentLayout);

      this.addComponent(component);
    }

    return component;
  }

  public startComponent(id: string, time: number): IComponentDocument {
    const component = this.getComponent(id);

    if (component) {
      component.startTime = time;
      component.layout.visible = true;
    }

    return component;
  }

  public stopComponent(id: string, time: number): IComponentDocument {
    const component = this.getComponent(id);

    if (component) {
      component.stopTime = time;
      component.layout.visible = false;
     }

    return component;
  }

  public removeComponent(id: string): IComponentDocument {
    const c = this.getComponent(id);

    if (c) {
      this.components.splice (this.components.indexOf(c), 1);
    }

    return c;
  }

  public updateComponent(cc: IComponentConstraint, params: any): any[] {
    const component = this.updateComponentParameters(cc.componentId, params);
    let updated = false;

    if (component && cc.constraintId) {
      if (this.select(this.constraints, (c) => c.constraintId === cc.constraintId).length === 0) {
        component.constraintId = Globals.defaultConstraintId;
      } else {
        if (component.constraintId === cc.constraintId) {
          updated = true;
        }
        component.constraintId = cc.constraintId;
      }
    }

    return [ component, updated ];
  }

  public updateComponentParameters(id: string, params: any): IComponentDocument {
    const component = this.getComponent(id);

    if (component) {
      if (!component.parameters) {
        component.parameters = params;
      } else {
        component.parameters = Object.assign(component.parameters, params);
      }
    }

    return component;
  }

  public showComponents(clist: string[]) {
    return new Promise ((resolve, _reject) => {
      clist.forEach((comp) => {
        this.getComponent(comp).layout.visible = true;
      });
      resolve(this.save());
    });
  }

  public hideComponents(clist: string[]) {
    return new Promise ((resolve, _reject) => {
      clist.forEach((comp) => {
        this.getComponent(comp).layout.visible = false;
      });
      resolve(this.save());
    });
  }

  public getResolvedPriorities(ctx, component, deviceids: string[]): any {
    /* global priorities */
    const res = {
      communal: this.getComponentConstraints(component.constraintId, true).priority,
      personal: this.getComponentConstraints(component.constraintId, false).priority,
    };

    /* append override priorities */
    deviceids.forEach ((devId) => {
      const device = ctx.getDevice(devId);
      if (isNullOrUndefined(device)) {
        res[devId] = { personal: -1, communal: -1 };
      } else {
        res[devId] = {
          communal: this.getPriority(component, device, "communal"),
          personal: this.getPriority(component, device, "personal"),
        };
      }
    });

    if (deviceids.length === 0) {
      return this.getAllResolvedPriorityOverrides (component);
    }

    return res;
  }

  public getAllResolvedPriorityOverrides(component): object {
    if (! component.hasOwnProperty("priorityOverrides")) {
      return {};
    }
    return {};
  }

  public getResolvedPriority(ctx: Context, component: IComponentDocument, deviceid: string): any {
    const device = ctx.getDevice(deviceid);
    if (isNullOrUndefined(device)) {
      return {
        communal: this.getComponentConstraints(component.constraintId, true).priority,
        personal: this.getComponentConstraints(component.constraintId, false).priority,
      };
    }
    return {
        communal: this.getPriority(component, device, "communal"),
        personal: this.getPriority(component, device, "personal"),
    };
  }

  public getPriority(c: any, device: IDeviceDocument, devtype: string): number {

    if (c.hasOwnProperty("priorityOverrides") && c.priorityOverrides.hasOwnProperty(devtype)) {
        const key = c.priorityOverrides[devtype].scope === "device"
          ? device.deviceId
          : c.priorityOverrides[devtype].scope === "group"
            ? device.group : "context";

        if (c.priorityOverrides[devtype].priorities.hasOwnProperty(key)) {
          return c.priorityOverrides[devtype].priorities[key];
        }
    }

    if (! c.hasOwnProperty("constraints)")) {
      return this.getComponentConstraints(c.constraintId, devtype === "communal").priority;
    }

    return c.constraints.priority;
  }

  public resolvePriority(c: any, device: IDeviceDocument, communal: boolean): number {
    return this.getPriority (c, device, communal ? "communal" : "personal");
  }

  /**
   * Extra method retun correct fields because MongoDB uses "_id"
   * and the client expects "contextId"
   */
  public toJSON() {
    return {
      DMAppId: this._id,
      contextId: this.contextId,
      spec: this.spec,
      components: this.components,
      timestamp: this.timestamp,
    };
  }
}
