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
import { IPrefSizeDocument, ISizeDocument, prefSizeSchema, sizeSchema } from "./Size";

/**
 * definition of a layout component
 * as stored in the database
 */

export interface IConfigDocument {
  url?: string;
  class: string;
}

const configSchema = {
  url: {
    $required: false,
    $type: String,
  },
  class: String,
};

interface IOverrideDocument {
  scope: string;
  priorities: Map<string, number>;
}

interface IOverridesDocument {
  personal?: IOverrideDocument;
  communal?: IOverrideDocument;
}

const prioritiesSchema = {
  communal: Number,
  personal: Number,
  overrides: {
    $required: false,
    $type: JSON,
  },
};

interface ILayoutDocument {
  position?: IPositionDocument;
  size?: ISizeDocument;
  zDepth?: number;
  instanceId: string;
  priority?: number;
  visible?: boolean;
}

const layoutSchema = {
  position:  {
    $required: false,
    $type: positionSchema,
  },
  size: {
    $required: false,
    $type: sizeSchema,
  },
  zDepth: {
    $required: false,
    $type: Number,
  },
  instanceId:  {
    $required: false,
    $type: String,
  },
  priority:  {
    $required: false,
    $type: Number,
  },
  visible: {
    $required: false,
    $type: Boolean,
  },
};

export interface IComponentDocument {
  componentId: string;
  constraintId?: string;
  config?: IConfigDocument;
  startTime?: number;
  stopTime?: number;
  layout?: ILayoutDocument;
  priorityOverrides?: IOverridesDocument;
  prefSize?: IPrefSizeDocument;
  parameters?: object;
}

export const componentSchema = {
  componentId: String,
  constraintId: {
    $required: false,
    $type: String,
  },
  config: {
    $required: false,
    $type: configSchema,
  },
  startTime: {
    $required: false,
    $type: Number,
  },
  stopTime: {
    $required: false,
    $type: Number,
  },
  layout: {
    $required: false,
    $type: layoutSchema,
  },
  priorities: {
    $required: false,
    $type: prioritiesSchema,
  },
  prefSize: {
    $required: false,
    $type: prefSizeSchema,
  },
  parameters: {
    $required: false,
    $type: Object,
  },
};

export interface IComponentConstraint {
  componentId: string;
  constraintId: string;
}

export class Component implements IComponentDocument {
  /* component ID */
  public componentId: string;

  /* component constraint ID used as index into DMAPP layout constraint doc */
  public constraintId?: string;

  /* last generated layouts for the component */
  public layout?: ILayoutDocument;

  /* override priorities specified in the constraints */
  public priorityOverrides?: IOverridesDocument;

  /* preferred layout size */
  public prefSize?: IPrefSizeDocument;

  /* application data, passed thru by the layout service */
  public config?: IConfigDocument;
  public startTime?: number;
  public stopTime?: number;
  public parameters?: any;
}
