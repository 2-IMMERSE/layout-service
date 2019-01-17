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
import { Globals } from "../globals";
import { Util } from "../Util";
import { IPrefSizeDocument, prefSizeSchema } from "./Size";

/**
 * set of constraints used to layout the components
 */

export interface IConstraintConfigDocument {
  aspect?: string;                      /* maintain aspect ratio of form "width:height" */
  prefSize?: IPrefSizeDocument;         /* preferred layout size - used as maximum too */
  minSize?: IPrefSizeDocument;          /* minimum layout size */
  targetRegions?: string[];             /* regions upon which component can be laid out - if absent will place component on any region */
  priority: number;                     /* relative component priority, high numbers have higher priority and are laid out first, 0 => invisible */
  audio?: boolean;                      /* if present and true, component is laid out only on devices that support audio  */
  video?: boolean;                      /* if present and true, component is laid out only on devices that support video  */
  touchInteraction?: boolean;           /* if present and true place component only on device that supports touch */
  margin?: number;                      /* lay out component leaving margin specified space */
  anchor?: string[];                    /* anchor component according to the requested anchors if present */
  componentDependency?: string[];       /* lay out component only if it's dependency was also laid out */
  componentDeviceDependency?: string[]; /* lay out component only if it's dependency was laid out on same device */
}

const constraintConfigSchema = {
  aspect: {
    $required: false,
    $type: String,
  },
  prefSize: {
    $required: false,
    $type: prefSizeSchema,
  },
  minSize: {
    $required: false,
    $type: prefSizeSchema,
  },
  targetRegions: {
    $required: false,
    $type: [String],
  },
  priority: Number,
  audio: {
    $required: false,
    $type: Boolean,
  },
  video: {
    $required: false,
    $type: Boolean,
  },
  touchInteraction: {
    $required: false,
    $type: Boolean,
  },
  margin: {
    $required: false,
    $type: Number,
  },
  anchor: {
    $required: false,
    $type: [String],
  },
  componentDependency: {
    $required: false,
    $type: [String],
  },
  componentDeviceDependency: {
    $required: false,
    $type: [String],
  },
};

export interface IConstraintDocument {
  constraintId: string;
  personal: IConstraintConfigDocument;
  communal: IConstraintConfigDocument;
}

export const constraintSchema = {
  constraintId: String,
  personal: constraintConfigSchema,
  communal: constraintConfigSchema,
};

export class Constraint implements IConstraintDocument {
  public constraintId: string;
  public personal: IConstraintConfigDocument;
  public communal: IConstraintConfigDocument;

  public static onCreating(doc: IConstraintDocument) {
    doc.constraintId = doc.constraintId;
    doc.personal = doc.personal || Util.clone(Globals.defaultComponentConstraint);
    doc.communal = doc.communal || Util.clone(Globals.defaultComponentConstraint);

    /* set a minimal minSize */
    if (! doc.personal.hasOwnProperty("minSize")) {
      doc.personal.minSize = Globals.absoluteMinSize;
    }
    if (! doc.communal.hasOwnProperty("minSize")) {
      doc.communal.minSize = Globals.absoluteMinSize;
    }
  }
}
