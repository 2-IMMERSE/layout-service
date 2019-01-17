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
import { sprintf } from "extsprintf";
import {Logger, LogLevel} from "./Logger";

/**
 * global variables and debugging utilities
 */

export class Globals {
  public static config = {
    debug: false,
    defaultDPI: 96,
    defaultConcurrentAudio: 1000,
  };

  public static packer = {
    MinDimension: 0,
    ReductionRate: 0.8,
    MaxIterations: 5,
    SingleReductionRate: 0.7,
  };

  public static absoluteMinSize = {
      width: 1,
      height: 1,
      mode: "px",
  };

  public static defaultComponentConstraint = {
    minSize: {
      width: Globals.packer.MinDimension,
      height: Globals.packer.MinDimension,
      mode: "px",
    },
    priority: 1,
    margin: 0,
  };

  public static defaultComponentLayout = {
    position: { x: 0, y: 0 },
    size: { width: -1, height: -1 },
    zDepth: 0,
    visible: false,
  };

  public static defaultConstraintId: string = "default";

  private static id: number = 15;

  public static configure(label: string = "debug", value: boolean = false): void {
    this.config[label] = value;
    if (label === "debug" && value) {
      Logger.configure("LayoutServiceEdge", LogLevel.DEBUG);
    }
  }

  public static debugmode(): boolean {
    return this.config.debug;
  }

  /* mongodb expects 24 hex character string */
  public static getID(): string {
    this.id = this.id + 1;
    return sprintf("%024d", this.id);
  }
}
