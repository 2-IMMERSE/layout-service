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
import { componentSchema, IComponentDocument } from "./Component";

interface ICapabilitiesDocument {
  displayWidth: number;
  displayHeight: number;
  displayResolution?: number;
  audioChannels?: number;
  concurrentAudio?: number;
  concurrentVideo?: number;
  touchInteraction?: boolean;
  communalDevice: boolean;
  deviceType: string;
  orientations: string[];
}

const capabilitiesSchema = {
  displayWidth: Number,
  displayHeight: Number,
  displayResolution: {
    $required: false,
    $type: Number,
  },
  audioChannels: {
    $required: false,
    $type: Number,
  },
  concurrentAudio: {
    $required: false,
    $type: Number,
  },
  concurrentVideo: {
    $required: false,
    $type: Number,
  },
  touchInteraction: {
    $required: false,
    $type: Boolean,
  },
  communalDevice: Boolean,
  deviceType: String,
  orientations: [String],
};

interface IRegionDocument {
  regionId: string;
  displayWidth: number;
  displayHeight: number;
  resizable: boolean;
}

const regionSchema = {
  regionId: String,
  displayWidth: Number,
  displayHeight: Number,
  resizable: Boolean,
};

/**
 * Representing a device embedded in a context
 */
export interface IDeviceDocument {
  deviceId: string;                     /* device id */
  caps: ICapabilitiesDocument;          /* capabilities - size, audio, etc. */
  orientation: string;                  /* landscape or portrait */
  regions?: IRegionDocument[];          /* list of logical regions, if present components are laid out over the regions, otherwise they are laid out directly onto the device */
  components?: IComponentDocument[];    /* list of components that have been laid out on the device */
  group: string;                        /* name of group of which device is a member */
}

export const deviceSchema = {
  deviceId: String,
  caps: capabilitiesSchema,
  orientation: String,
  regions: {
    $required: false,
    $type: [regionSchema],
  },
  components: {
    $required: false,
    $type: [componentSchema],
  },
  group: String,
};

export class Device {
  public static meetConstraints(device, constraints): boolean {
    if (constraints == null) {
      return true;
    }

    if ( constraints.hasOwnProperty("minSize")) {
      if (constraints.minSize.width > device.caps.displayWidth - 2 * constraints.margin) {
        return false;
      }
      if (constraints.minSize.height > device.caps.displayHeight - 2 * constraints.margin) {
        return false;
      }
    }

    if ((constraints.hasOwnProperty("audio") && constraints.audio === true) && device.caps.concurrentAudio < 1) {
      return false;
    }
    if ((constraints.hasOwnProperty("video") && constraints.video === true) && device.caps.concurrentVideo < 1) {
      return false;
    }

    if ((constraints.hasOwnProperty("touchInteraction") && constraints.touchInteraction === true)
        && !(device.caps.hasOwnProperty("touchInteraction") && device.caps.touchInteraction === true)) {
      return false;
    }

    return true;
  }
}
