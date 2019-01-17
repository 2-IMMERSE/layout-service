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
import * as uuid from "uuid";

interface IBox {
  width: number;
  height: number;
}

/**
 * Singleton with several utility methods
 */
export class Util {
  public static idSeparator: string = "_";

  /**
   * Concatenate contextId and deviceId
   *
   * @param contextId
   * @param devideId
   */
  public static roomId(contextId: string, room: string): string {
    return contextId + "." + room;
  }

  /**
   * Test if box1 is bigger than box2
   *
   * @param  box1
   * @param  box2
   */
  public static isLarger(box1: IBox, box2: IBox): number {
    return box1.width < box2.width
      ? 1 : box1.width > box2.width
      ? -1 : box1.height < box2.height
           ? 1 : box1.height > box2.height
            ?  -1 : 0;
  }

  public static componentInstanceId(ctxid: string, dmappid: string, deviceid: string, componentid: string): string {
    return ctxid + Util.idSeparator + dmappid + Util.idSeparator + deviceid + Util.idSeparator + componentid;
  }

  public static isEqualwithPrecision(f1: number, f2: number, precision): boolean {
    const epsilon: number = precision;
    const diff: number = f1 - f2;
    return (diff < epsilon && diff > (-1 * epsilon));
  }

  // TODO: we should find a more performant solution to this
  public static clone(obj: any): any {
    return JSON.parse(JSON.stringify(obj));
  }

  public static genMessageId(): string {
    return uuid.v1();
  }
}
