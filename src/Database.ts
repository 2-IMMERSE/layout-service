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
/* tslint:disable */
import * as Iridium from "iridium";
import { Context, IContextDocument } from "./model/Context";
import { DMApp, IDMAppDocument } from "./model/DMApp";
import { Layout, ILayoutDocument } from "./model/Layout";

export class Database extends Iridium.Core {
  public Contexts = new Iridium.Model<IContextDocument, Context>(this, Context);
  public DMApps = new Iridium.Model<IDMAppDocument, DMApp>(this, DMApp);
  public Layouts = new Iridium.Model<ILayoutDocument, Layout>(this, Layout);
}
