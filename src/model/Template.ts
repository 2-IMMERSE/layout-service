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
import { IPositionDocument, positionSchema } from "./Position";
import { ISizeDocument, sizeSchema } from "./Size";

interface IRegionDocument {
  id: string;
  position: IPositionDocument;
  size: ISizeDocument;
}

const regionSchema = {
  id: String,
  position: positionSchema,
  size: sizeSchema,
};

interface IOrientationDocument {
  region: IRegionDocument;
}

const orientationSchema = {
  region: regionSchema,
};

interface ITemplateDeviceDocument {
  portrait: IOrientationDocument[];
  landscape: IOrientationDocument[];
}

const templateDeviceSchema = {
  portrait: [orientationSchema],
  landscape: [orientationSchema],
};

interface ITemplateLayoutDocument {
  communal: ITemplateDeviceDocument;
  personal: ITemplateDeviceDocument;
}

const templateLayoutSchema = {
  communal: templateDeviceSchema,
  personal: templateDeviceSchema,
};

export interface ITemplateDocument {
  deviceType: string;
  layout: ITemplateLayoutDocument;
}

export const templateSchema = {
  deviceType: String,
  layout: templateLayoutSchema,
};
