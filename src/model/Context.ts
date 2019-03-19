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
import { Timestamper } from "../Timestamper";
import { deviceSchema, IDeviceDocument } from "./Device";

/**
 * a context is the set of devices and components and dmapp definition
 * the layout engine lays out all the components in a context over the context devices using the dmapp definitions
 *
 * devices in a context may be organized in groups
 * in this case the engine will lay out all the components onto each group of devices.
 * a group may consist of only communal devices, in which case the engine uses communal rules for the entire layout
 * a group may consist of only personal devices in which case personal rules are used, or
 * a group may contain both personal and communal devices in which case communal rules are used for the communal
 */

export const groupType = Object.freeze ({communal: "communal", personal: "personal", mixed: "mixed"});

interface IConfigDocument {
  percentCoords?: boolean;
  reduceFactor?: number;
  reduceTries?: number;
}

export interface IGroupDocument {
  id: string;
  type: string;
}

const configSchema = {
  percentCoords: {
    $required: false,
    $type: Boolean,
  },
  reduceFactor:  {
    $required: false,
    $type: Number,
  },
  reduceTries:  {
    $required: false,
    $type: Number,
  },
};

const groupSchema = {
  id: String,
  type: groupType,
};

export interface IContextDocument {
  _id?: string;
  devices: IDeviceDocument[];
  config?: IConfigDocument;
  data?: any;
  timestamp: number;
  updatedAt: Date;
}

@Iridium.Index({ _id: 1 })
@Iridium.Index({ updatedAt: 1 }, { expireAfterSeconds: 518000 })
@Iridium.Index({ "devices.deviceId": 1 }, { sparse: true })
@Iridium.Collection("contexts")
export class Context extends Iridium.Instance<IContextDocument, Context> implements IContextDocument {
  @Iridium.ObjectID
  public _id: string;

  @Iridium.Property([deviceSchema])
  public devices: IDeviceDocument[];

  @Iridium.Property({
    $required: false,
    $type: configSchema,
  })
  public config: IConfigDocument;

  @Iridium.Property(Date)
  public updatedAt: Date;

  @Iridium.Property(Number)
  public timestamp: number;

  @Iridium.Property(Map)
  public data: any;

  public static onCreating(doc: IContextDocument) {
    doc.devices = doc.devices || [];
    doc.updatedAt = new Date();
    doc.timestamp = Timestamper.getTimestampNS();
    doc.config = doc.config || { percentCoords: false };
    doc.data = doc.data || null;
  }

  public static onSaving(instance: Context, _changes: Iridium.Changes) {
    instance.updatedAt = new Date();
    instance.timestamp = Timestamper.getTimestampNS();
  }

  public updateDevice(deviceId: string, changes: any): Promise<Context> {
    const changeset = {
      $set: {},
    };

    Object.keys(changes).forEach((key) => {
      changeset.$set["devices.$." + key] = changes[key];
    });

    return this.save({
      "_id": this._id,
      "devices.deviceId": deviceId,
    }, changeset);
  }

  public getDeviceGroups(): IGroupDocument[] {
    const deviceGroups: IGroupDocument[] = 123456[];
    this.devices.forEach((device) => {
      const group = deviceGroups.find((elem) => elem.id === device.group);
      if (isNullOrUndefined(group)) {
        deviceGroups.push({
          id: device.group,
          type: device.caps.communalDevice ? groupType.communal : groupType.personal,
        });
      } else {
        if ((group.type === groupType.personal && device.caps.communalDevice) || (group.type === groupType.communal && !device.caps.communalDevice)) {
          group.type = groupType.mixed;
        }
      }
    });
    return deviceGroups;
  }

  public addDevice(device: IDeviceDocument): Promise<Context> {
        return this.save({
            $push: {
              devices: device as any,
            },
        });
  }

  public removeDevice(deviceId: string): Promise<Context> {
    return this.save({
      $pull: {
        devices: {
          deviceId: { $eq: deviceId },
        },
      },
    });
  }

  public hasDevice(deviceId: string): boolean {
    return this.devices.some((device) => {
      return device.deviceId === deviceId;
    });
  }

  public getDevice(deviceId: string): IDeviceDocument {
    return this.devices.find((dev) => (dev.deviceId === deviceId));
  }

  public isCommunalDevice(deviceId: string): boolean {
     const dev = this.devices.find((checkDevice) => (checkDevice.deviceId === deviceId));
     return dev != null ? dev.caps.communalDevice : true;
  }

  public getDeviceRegions(dev) {
    return dev.hasOwnProperty("regions") && (dev.regions != null)
        ? dev.regions
        : [];
  }

  public formatDevice(deviceId: string): object {
    const device = this.devices.find((dev) => (dev.deviceId === deviceId));

    if (! device) {
      return device;
    }

    const regions = {};
    this.getDeviceRegions(device).forEach((r) => {
      regions[r.regionId] = r;
    });

    return {
      id: device.deviceId,
      context: this._id,
      orientation: device.orientation,
      caps: device.caps,
      group: device.group,
      regions,
    };
  }

  public getDevices(): object {
    /* backwards compatible dictionary representation for output formatting and indexed access */
    const devices = {};
    this.devices.forEach ((dev) => {
      devices[dev.deviceId] = {
        id:           dev.deviceId,
        context:      this._id,
        orientation:  dev.orientation,
        caps:         dev.caps,
        regions:      {},
      };
      this.getDeviceRegions(dev).forEach((r) => {
        devices[dev.deviceId].regions[r.regionId] = r;
      });
    });
    return devices;
  }

  public getDeviceList(): string[] {
    const devices: string[] = [];

    this.devices.forEach((device) => {
      devices.push(device.deviceId);
    });

    return devices;
  }

  public getGroupDevices(groupId: string): string[] {
    const devices: string[] = [];
    this.devices.forEach((device) => {
      if (device.group === groupId) {
        devices.push(device.deviceId);
      }
    });
    return devices;
  }

  /**
   * Extra method returns correct fields because MongoDB uses "_id"
   * and the client expects "contextId"
   */
  public toJSON() {
    return {
      contextId: this._id,
      devices: this.devices,
      config: this.config,
      deviceGroups: this.deviceGroups,
      timestamp: this.timestamp,
    };
  }
}
