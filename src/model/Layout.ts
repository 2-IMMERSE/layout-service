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
import { Timestamper } from "../Timestamper";
import { Component, IComponentDocument } from "./Component";

/**
 * structure of a generated layout
 * last computed layout is stored in the database
 * used to notify when new components are introduced into
 * the layout
 */

interface IPlacementGroupDocument {
  group: string;
  status: string;
  components: string[];
}

const placementGroupSchema = {
  group: String,
  status: String,
  components: [String],
};

export interface IDeviceLayoutDocument {
  deviceId: string;
  components: IComponentDocument[];
}

const deviceLayoutSchema = {
  deviceId: String,
  components: [Component],
};

export interface ILayoutDocument {
  _id?: string;
  devices?: IDeviceLayoutDocument[];
  notPlaced?: IPlacementGroupDocument[];
  timestamp: number;
  updatedAt: Date;
}

@Iridium.Index({ _id: 1 })
@Iridium.Index({ updatedAt: 1 }, { expireAfterSeconds: 518000 })
@Iridium.Index({ "devices.deviceId": 1 }, { sparse: true })
@Iridium.Collection("layouts")
export class Layout extends Iridium.Instance<ILayoutDocument, Layout>  implements ILayoutDocument {
  @Iridium.ObjectID
  public _id: string;

  @Iridium.Property([deviceLayoutSchema])
  public devices: IDeviceLayoutDocument[];

  @Iridium.Property([placementGroupSchema])
  public notPlaced: IPlacementGroupDocument[];

  @Iridium.Property(Date)
  public updatedAt: Date;

  @Iridium.Property(Number)
  public timestamp: number;

  public static onCreating(doc: ILayoutDocument) {
    doc._id = doc._id;
    doc.devices = doc.devices || [];
    doc.notPlaced = doc.notPlaced || [];
    doc.updatedAt = new Date();
    doc.timestamp = Timestamper.getTimestampNS();
  }

  public static onSaving(instance: Layout, _changes: Iridium.Changes) {
    instance.updatedAt = new Date();
    instance.timestamp = Timestamper.getTimestampNS();
  }

  public updateLayout( changes: any): Promise<Layout> {
    const changeset = {
      $set: {},
    };

    Object.keys(changes).forEach((key) => {
      changeset.$set[ key] = changes[key];
    });

    return this.save({
      _id: this._id,
    }, changeset);
  }

  /**
   * retrieve the list of devices a component has been laid out on
   * @param comp - component id
   */
  public getComponentDevices(comp: string) {
    const devices = {};
    this.devices.forEach ((dev: IDeviceLayoutDocument) => {
      if (dev.components.find((c) => (c.componentId === comp)) != null) {
        const id = dev.deviceId;
        if (! devices.hasOwnProperty(id)) {
          devices[id] = [];
        }
        devices[id].push (comp);
      }
    });
    return devices;
  }
}
