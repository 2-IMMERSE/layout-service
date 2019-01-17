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
import * as _ from "underscore";
import {isNullOrUndefined} from "util";
import { Globals} from "../globals";
import { Logger } from "../Logger";
import { IConfigDocument} from "../model/Component";
import {IPrefSizeDocument, ISizeDocument} from "../model/Size";

import { Util} from "../Util";

/**
 * utility classes and functions used by the packing engine
 */

export class PackingSize implements IPrefSizeDocument {
  public height: number;
  public width: number;
  public mode?: string;
  public widthInches?: number;
  public heightInches?: number;
}

export interface ILayoutConstraint {
  _aspect?: number;
  aspect?: string;
  prefSize?: PackingSize;
  minSize?: PackingSize;
  valid?: string[];
  priority: number;
  audio?: boolean;
  video?: boolean;
  touchInteraction?: boolean;
  margin?: number;
  marginInches?: number;
  anchor?: string[];
  dependencies?: string[];
}

export class PackerRegion {
    public x0: number;
    public y0: number;
    public width: number;
    public height: number;
    public dpi: number;
    public deviceId: string;
    public regionId: string;
    public boundingWidth: number;
    public boundingHeight: number;
    public maxVideo: number;
    public maxAudio: number;
    public suitable: boolean;
    public communal: boolean;
    public cid: string;
    public child1: PackerRegion;
    public child2: PackerRegion;
}

export class PackerRectangle extends PackerRegion {
  public componentId: string;
  public dmAppId: string;
  public contextId: string;
  public margin: number;
  public constraints: ILayoutConstraint;
  public personalconstraints: ILayoutConstraint;
  public config: IConfigDocument;
  public parameters: any;
  public startTime: number;
  public stopTime: number;
  public layout: object;
  public boundingX0?: number;
  public boundingY0?: number;
  public boundingX1?: number;
  public boundingY1?: number;
}

export class PackerNode {
  public id: number;
  public rect: PackerRectangle;
  public occupiedBy: string;
 }

export class Node extends PackerNode {
  public child?: Node[];
  public split?: string;
  public dropped?: boolean;
  public fitChild?: number;
}

export class Packing {
  public tree?: Node[];
  public rects?: PackerRectangle[];
  public layout?: any[];
  public notPlaced: any[];
  public noDevice?: any[];
  public noDependent?: string [];
}

export class BBox {
  public boundingWidth: number;
  public boundingHeight: number;
  public width: number;
  public height: number;
  public boundingX0?: number;
  public boundingY0?: number;
  public boundingX1?: number;
  public boundingY1?: number;
  public centerX?: number;
  public centerY?: number;
}

export class Pruner {
   public trees: PackerNode[];
   public rects: PackerRectangle [];
   public prunedTrees: PackerNode[];
   public prunedRects: PackerRectangle [];
}

export class PackerUtils {

  public static noAspect: number = 0.0;

  public static minRect: IPrefSizeDocument  = {
    width: Globals.packer.MinDimension,
    height: Globals.packer.MinDimension,
    mode: "px",
  };

  public static defaultPrefSize: IPrefSizeDocument = {
    width: -1,
    height: -1,
    mode: "px",
  };

  private static uuidCtr: number = 0;

  /**
   * return constraints to be used for the given component
   * @param node
   * @param mixedGroup
   * @param rect - the component
   */
  public static resolveConstraints(node: Node, mixedGroup: boolean, rect: PackerRectangle): ILayoutConstraint {
    return (mixedGroup && !node.rect.communal) ? rect.personalconstraints : rect.constraints;
  }

  /**
   * @return rectangle size in pixels, corrected to maintain aspect ration if necessary
   * @param constraint
   * @param bbox
   */
  public static rectSize(constraint: ILayoutConstraint, bbox = null): ISizeDocument {
    if (isNullOrUndefined((bbox))) {
      bbox = { boundingWidth: 1000, boundingHeight: 1000, dpi: 96};
    }
    const minsize = PackerUtils.toPixelResolution(constraint.minSize, this.minRect, bbox);
    const pixels = PackerUtils.toPixelResolution (constraint.prefSize, minsize, bbox);
    const size
      = PackerUtils.correctedSize(pixels.width, pixels.height, constraint.margin, constraint._aspect, bbox.boundingWidth, bbox.boundingHeight );
    return {
      width: size.width,
      height: size.height,
    };
  }

  /**
   * traverse a tree looking for a particular node
   * @param root
   * @param node
   */
  public static locateNode(root, node) {
    if (root.id === node.id) {
      return root;
    }

    if (!root.hasOwnProperty("child")) {
      return null;
    }

    const theNode = PackerUtils.locateNode(root.child[0], node);
    if (theNode != null) {
      return theNode;
    }

    return PackerUtils.locateNode(root.child[1], node);
  }

  /**
   * @return size in pixels
   * @param size
   * @param defaultval
   * @param bbox
   * @param aspect
   */
  public static toPixelResolution(size, defaultval = PackerUtils.minRect,
                                  bbox: any = { boundingWidth: 1000, boundingHeight: 1000, dpi: 96},
                                  aspect: number = PackerUtils.noAspect): ISizeDocument {
    const pixelsize = {
      width: size.width === -1 ? defaultval.width : size.width,
      height: size.height === -1 ? defaultval.height : size.height,
    };

    if (size.mode === "inches") {
      pixelsize.width = size.widthInches * bbox.dpi ;
      pixelsize.height = size.heightInches * bbox.dpi ;
    } else if (size.mode === "percent") {
      pixelsize.width = size.width * bbox.boundingWidth / 100.0;
      pixelsize.height = size.height * bbox.boundingHeight / 100.0;
    }

    if (aspect !== PackerUtils.noAspect) {
      if (size.width === 0) {
        pixelsize.width = Math.trunc(pixelsize.height / aspect);
      } else {
        pixelsize.height = Math.max(pixelsize.height, Math.trunc(pixelsize.width * aspect));
      }
    }

    return pixelsize;
  }

  /**
   * @return true if rect meets minimum size requirements
   * @param rect
   * @param minRect
   * @param bbox
   */
  public static meetsMinReq(rect, minRect, bbox): boolean {
    const minsize = PackerUtils.toPixelResolution(minRect, PackerUtils.minRect, bbox);
    if (rect.width > 0 && rect.width < minsize.width) {
      return false;
    }

    if (rect.height > 0 && rect.height < minsize.height) {
      return false;
    }

    return true;
  }

  /**
   * cover function to remove margin from the computation
   * @return size adjusted to preserve aspect ratio
   * @param width
   * @param height
   * @param margin
   * @param aspect
   * @param boundingwidth
   * @param boundingheight
   */
  public static correctedSize(width: number, height: number, margin: number, aspect: number, boundingwidth: number, boundingheight: number): ISizeDocument {
    const m = margin;
    const w = width - m;
    const h = height - m;
    const size = PackerUtils.getAspectCorrectedComponentSize (w, h, margin, aspect, boundingwidth, boundingheight);

    return {
      width: size.width + m,
      height: size.height + m,
    };
  }

  /**
   * @return size adjusted to preserve aspect ratio
   * @param width
   * @param height
   * @param margin
   * @param aspect
   * @param boundingW
   * @param boundingH
   */  public static getAspectCorrectedComponentSize(width: number, height: number, margin: number, aspect: number, boundingW: number, boundingH: number) {
    if (aspect === PackerUtils.noAspect) {
      return { width, height };
    }

    const m = 2 * margin;
    let w = width ;
    let h = height ;

    if (aspect <= 1.0 ) {
      h = w * aspect;
      if (h + m > boundingH) {
        h = height - m;
        w = h / aspect;
      }
    } else if (aspect > 1.0) {
      w = h / aspect;
      if (w + m > boundingW) {
        w = width - m;
        h = w * aspect;
      }
    }

    return {
      width: Math.trunc(w),
      height: Math.trunc(h),
    };
  }

  /**
   * adjust non primary dimension to maintain aspect ratio
   * @param width
   * @param height
   * @param aspect
   * @param margin
   * @param primaryDir
   */
  public static directed_aspect_correct(width, height, aspect, margin, primaryDir) {
    const m = 2 * margin;
    let h = height - m;
    let w = width - m;

    if (primaryDir === "width") {
      h = w * aspect;
      if (h + m > height) {
        h = height - m;
        w = h / aspect;
      }
    } else {
      w = h / aspect;
      if (w + m > width) {
        w = width - m;
        h = w * aspect;
      }
    }

    h += m;
    w += m;

    return { width: Math.trunc(w), height: Math.trunc(h) };
  }

  /**
   * adjust non primary dimension to maintain aspect ratio while honoring minimum dimension requirements
   * @param width
   * @param height
   * @param aspect
   * @param margin
   * @param primaryDir
   * @param minsize
   * @private
   */
  public static directed_aspect_correct_(width, height, aspect, margin, primaryDir, minsize) {
    const m = 2 * margin;
    let h = height - m;
    let w = width - m;

    if (primaryDir === "width") {
      h = w * aspect;
      if (h + m > height) {
        h = height - m;
        w = h / aspect;
      }
    } else {
      w = h / aspect;
      if (w + m > width) {
        w = width - m;
        h = w * aspect;
      } else if (w < minsize.width) {
        w = minsize.width - m;
        h = w * aspect;
      }
    }

    h += m;
    w += m;

    return { width: Math.trunc(w), height: Math.trunc(h) };
  }

  /**
   * do the aspect ratio correct without checking anything
   * @param width
   * @param height
   * @param aspect
   * @param margin
   * @param dir
   */
  public static directed_aspect_correct_no_check(width, height, aspect, margin, dir) {
    const m = 2 * margin;
    let h = height - m;
    let w = width - m;

    if (dir === "width") {
      h = w * aspect;
    } else {
      w = h / aspect;
    }

    h += m;
    w += m;

    return { width: Math.trunc(w), height: Math.trunc(h) };
  }

  /* ---------------------------------------------------------------------
   * prepare rectangles for packing
   * order them sorted by priority, size, other constraints
   */
  public static area(rect) {
    return rect.width * rect.height;
  }

  public static larger(box1, box2) {
    const r = this.largerEqual(box1, box2);
    return (r === 0) ? -1 : r;
  }

  public static larger_first(box1, box2) {
    const r = this.largerEqual(box1, box2);
    return (r !== 0) ? r : PackerUtils.topleft(box1, box2);
  }

  public static larger_tl(box1, box2) {
    const r = this.largerAreaEqual(box1, box2);
    return (r !== 0) ? r : PackerUtils.topleft(box1, box2);
  }

  public static smaller_tl(box1, box2) {
    const r = this.smaller(box1, box2);
    return (r !== 0) ? r : PackerUtils.topleft(box1, box2);
  }

  public static topleft(box1, box2) {
    return box1.y0 > box2.y0 ? 1 : box1.y0 <  box2.y0 ? -1 : box1.x0 > box2.x0 ? 1 : -1;
  }

  public static largerEqual(box1, box2) {
    const w1: number = box1.width;
    const w2: number = box2.width;
    const h1: number = box1.height;
    const h2: number = box2.height;
    const area1: number = w1 * h1;
    const area2: number = w2 * h2;

    return area1 < area2 ? 1 : area1 > area2 ? -1
        : w1 < w2
            ?  1 : w1 > w2
                ?  -1 : h1 < h2
                    ? 1 : (h1 === h2) ? 0 : -1;
  }

  public static largerDimArea(box1, box2) {
    const w1: number = box1.width;
    const w2: number = box2.width;
    const h1: number = box1.height;
    const h2: number = box2.height;
    const area1: number = w1 * h1;
    const area2: number = w2 * h2;

    return  w1 < w2
      ? 1 : w1 > w2
        ? -1 : area1 < area2
        ?  1 : area1 > area2
          ?  -1 : h1 < h2
            ? 1 : (h1 > h2)
              ? -1 : ( 0);
  }

  public static smaller(box1, box2): number {
    const w1: number = box1.width;
    const w2: number = box2.width;
    const h1: number = box1.height;
    const h2: number = box2.height;
    const area1: number = w1 * h1;
    const area2: number = w2 * h2;

    return  w1 < w2
      ?  -1 : w1 > w2
        ?  1 : h1 < h2
          ? -1 : (h1 > h2)
            ? 1 : (area1 < area2 ? -1 : area1 > area2 ? 1 : 0);
  }

  public static _larger(box1, box2): number {
    const r: number = PackerUtils.smaller (box1, box2);
    return (r === -1 ? 1 : r === 1 ? -1 : r);
  }

  public static largerAreaEqual(box1, box2) {
    const w1: number = box1.width;
    const w2: number = box2.width;
    const h1: number = box1.height;
    const h2: number = box2.height;
    const area1: number = w1 * h1;
    const area2: number = w2 * h2;
    return area1 < area2 ? 1 : area1 > area2 ? -1 : 0;
  }

  /**
   * if preferred size was set to don't care (-1), compute it now
   * @return leg length
   * @param node
   * @param parentRect
   * @param factor
   * @param which
   * @param minSize
   * @param margin
   */
  public static setUndefinedLegLength(node, parentRect, factor, which, minSize, margin): number {
    const dim = parentRect[which] * factor - 2 * margin;
    const leg = node.rect[which] * factor - 2 * margin;
    if (PackerUtils.area(node.rect) > PackerUtils.area(parentRect)) {
      return leg >= minSize[which] ? leg : dim;
    }
    return (dim >= minSize[which]) ? dim : leg ;
  }

  /**
   * sort top priority items by size
   * @return sorted list of packing rectangles
   * @param rects
   * @param packingRegions
   * @param byArea
   */
  public static sortRects(rects: PackerRectangle[], packingRegions, byArea: boolean): PackerRectangle[] {
    rects = rects.sort((a, b) => {
      const pa: number = a.constraints.priority;
      const pb: number = b.constraints.priority;
      return pa < pb
        ? 1
        : pa > pb
            ? -1 : PackerUtils.larger(PackerUtils.rectSize(a.constraints, packingRegions[0]), PackerUtils.rectSize(b.constraints, packingRegions[0]))
        ;
    });

    // const packedRects = PackerUtils.pruneDuplicateCorners(rects); // do this per packing region!!!
    const packedRects = rects;

    /* sort components per region they can be placed on */
    const toBePacked = PackerUtils.prepareRects(packedRects, packingRegions, byArea);
    const dontFit = _.difference(rects, toBePacked);

    rects = _.union(toBePacked, dontFit);
    rects.forEach ((r) => {
      if (r.constraints.prefSize.width === -1) {
        r.width = -1;
      }
      if (r.constraints.prefSize.height === -1) {
        r.height = -1;
      }
    });

    return rects;
  }

  /**
   * @return list of rectangles sorted by priority and then by size
   * @param rects
   * @param packingRegions
   */
  public static prioritizeRects(rects: PackerRectangle[], packingRegions): PackerRectangle[] {
    return rects.sort((a, b) => {
      const pa: number = a.constraints.priority;
      const pb: number = b.constraints.priority;
      return pa < pb
        ? 1
        : pa > pb
          ? -1 : PackerUtils._larger(PackerUtils.rectSize(a.constraints, packingRegions[0]), PackerUtils.rectSize(b.constraints, packingRegions[0]))
        ;
    });
  }

  /**
   * @return white space left in a node
   * @param nodelist
   */
  public static computeFillSpace(nodelist: PackerRectangle[]): number {
    let fillspace = 0;
    nodelist.forEach ((node) => {
      fillspace += this.area(node);
    });
    return fillspace;
  }

  /**
   * @return white space in a list of regions
   * @param nodelist
   * @param regionlist
   */
  public static computeWhiteSpace(nodelist: PackerRectangle[], regionlist): number {
    const fillspace = PackerUtils.computeFillSpace(nodelist);
    let availableRE = 0;
    regionlist.forEach ((r) => {
      availableRE += (r.boundingWidth * r.boundingHeight);
    });
    return availableRE - fillspace;
  }

  public static regionSpace(regionlist): number {
    let availableRE = 0;
    regionlist.forEach ((r) => {
      availableRE += (r.boundingWidth * r.boundingHeight);
    });
    return availableRE ;
  }

  public static regionsWithWhiteSpace(rects: PackerRectangle[], regionlist): any[] {
    const regionFill = {};
    rects.forEach((r) => {
      const id = r.regionId + "_" + r.deviceId;
      if (! regionFill.hasOwnProperty(id)) {
        regionFill[id] = {};
        regionFill[id].fill = 0;
        regionFill[id].area = r.boundingHeight * r.boundingWidth;
      }
      regionFill[id].fill += r.width * r.height;
    });

    const regionsWithWS = [];
    regionlist.forEach((r) => {
      const id = r.regionId + "_" + r.deviceId;
      if (regionFill.hasOwnProperty(id) && regionFill[id].area > regionFill[id].fill) {
        regionsWithWS.push(r);
      }
    });
    return regionsWithWS;
  }

  /**
   * @return list of sorted rectangles per region
   * @param rects
   * @param trees
   * @param areaFirst
   */
  public static prepareRects(rects: PackerRectangle[], trees, areaFirst: boolean): PackerRectangle[] {
    let toBePacked = [];
    let totalRealEstate =  0;
    let usedRealEstate = 0;
    const boxes = {};

    _.map (rects, (r) => {
      _.map (r.constraints.valid, (item) => {
        if (! boxes.hasOwnProperty(item)) {
          boxes[item] = [];
        }
        boxes[item].push (r);
      });

      if (r.constraints.prefSize.mode === "inches") {
        r.constraints.prefSize.widthInches = r.constraints.prefSize.width;
        r.constraints.prefSize.heightInches = r.constraints.prefSize.height;
        r.constraints.marginInches = r.constraints.margin;
      }

      if (r.constraints.minSize.mode === "inches") {
        r.constraints.minSize.widthInches = r.constraints.minSize.width;
        r.constraints.minSize.heightInches = r.constraints.minSize.height;
      }
    });

    for (const name in boxes) {
      let t = _.findWhere (trees, { regionId: name });
      if (t == null) {
        t = _.findWhere (trees, { deviceId: name });
      }
      if (t == null) {
        continue;
      }

      totalRealEstate = t.width * t.height;
      const boxRects = [];
      usedRealEstate = 0;

      for (const box of boxes[name]) {
        const rsize = PackerUtils.rectSize(box.constraints, t);
        usedRealEstate += rsize.width * rsize.height;
        if (usedRealEstate > totalRealEstate) {
          break;
        }
        boxRects.push(box);
      }

      boxRects.sort((a, b) => {
        const rsizeA = PackerUtils.rectSize(a.constraints, t);
        const rsizeB = PackerUtils.rectSize(b.constraints, t);

        return (areaFirst) ? PackerUtils.larger(rsizeA, rsizeB) : PackerUtils.largerDimArea(rsizeA, rsizeB);

        // if (areaFirst) {
        //     if (PackerUtils.area(rsizeA) < PackerUtils.area(rsizeB)) {
        //     return 1;
        //   }
        //   if (PackerUtils.area(rsizeA) > PackerUtils.area(rsizeB)) {
        //     return -1;
        //   }
        //   if ( rsizeB.width > rsizeA.width) {
        //     return 1;
        //   }
        //   if (rsizeB.width < rsizeA.width) {
        //     return -1;
        //   }
        // } else {
        //   if ( rsizeB.width > rsizeA.width) {
        //     return 1;
        //   }
        //   if (rsizeB.width < rsizeA.width) {
        //     return -1;
        //   }
        //   if (PackerUtils.area(rsizeA) < PackerUtils.area(rsizeB)) {
        //     return 1;
        //   }
        //   if (PackerUtils.area(rsizeA) > PackerUtils.area(rsizeB)) {
        //     return -1;
        //   }
        // }
        // const dw = rsizeB.width - rsizeA.width;
        // if (dw > 0 ) {
        //   return 1;
        // }
        // if (dw < 0 ) {
        //   return -1;
        // }
        // return rsizeB.height > rsizeA.height ? 1 :  -1 ;
      });

      toBePacked = _.union (toBePacked, boxRects);
    }

    return toBePacked;
  }

  /* ---------------------------------------------------------------------------------
   * build trees with the set of regions over which we can place the rectangles
   */
  public static uuid(): number {
    PackerUtils.uuidCtr += 1;
    return PackerUtils.uuidCtr;
  }

  /**
   * @return list of nodes with the set of regions over which we can place the rectangles
   * @param regions
   */
  public static buildtreelist(regions): PackerNode[] {
    return regions.map ((reg) => {
      return ({
        id:     PackerUtils.uuid(),
        rect:   reg,
        occupiedBy: null,
        bbox: {},
       });
    });
  }

  /**
   * @return list of regions to be used in layout
   * @param rects
   * @param packingregions
   */
  public static  regionsToRebuild(rects, packingregions) {
    const regions = [];
    rects.forEach ((p) => {
      p.constraints.valid.forEach ((v) => {
        if (!_.contains(regions, v)) {
          let region = packingregions.find((r) => (r.regionId === v));
          if (region == null) {
            if (!regions.find((r) => (r.deviceId === region.deviceId))) {
              region = packingregions.find((r) => (r.deviceId === v));
            }
          } else {
            if (! (regions.find((r) => (r.regionId === region.regionId)) && (regions.find((r) => r.deviceId === region.deviceId)))) {
              regions.push(Util.clone(region));
            }
          }
        }
      });
    });

    return (regions);
  }

  /**
   * remove nodes from node list that have rectangles with preferred regions placed there
   * remove those rects from the rect list
   * in the end we have a list of nodes containing regions that can be re-packed
   * @param data
   * @param reallyPrune
   */
  public static prunePrefRegions(data: Pruner, reallyPrune: boolean = true): Pruner {
    if (reallyPrune) {
      /*
       * build up rejected node list, based on whether one of the rectangles placed on it has preferred size declared
       */
      data.rects.forEach((r) => {
        if (r.constraints.prefSize.width > -1 || r.constraints.prefSize.height > -1) {
          /* remove this node from the list */
          const node = data.trees.find((n) => n.rect.regionId === r.regionId && n.rect.deviceId === r.deviceId);
          data.prunedTrees.push(node);
          data.prunedRects.push(r);
        }
      });
      data.prunedTrees = _.uniq(data.prunedTrees);
      data.prunedTrees = _.without(data.prunedTrees, undefined);
      data.prunedRects = _.without(data.prunedRects, undefined);

      /*
       * if we have such node, prune all rectangles that had been placed on the removed node
       */
      if (data.prunedTrees.length > 0) {
        data.prunedRects.forEach((r) => {
          data.rects = _.reject(data.rects, r);
        });
        const rrects = [];
        data.rects.forEach((rect) => {
          const nn = data.prunedTrees.find((n) => n.rect.regionId === rect.regionId && n.rect.deviceId === rect.deviceId);
          if (!isNullOrUndefined(nn)) {
            data.prunedRects.push(rect);
            rrects.push(rect);
          }
        });
        data.prunedRects = _.uniq(data.prunedRects);
        rrects.forEach((r) => {
          data.rects = _.reject(data.rects, r);
        });
        data.prunedTrees.forEach((n) => {
          data.trees = _.reject(data.trees, n);
        });
      }
    }

    return data;
  }

  /* --------------------------------------------------------------------------------------------------------------------------
   */
  /**
   * optimization: prune components from list who overlap same corner in same region as higher priority component
   * @return array of rects
   * @param rects
   */
  public static pruneDuplicateCorners(rects) {
    const ret = [];
    const corners = {
      TR: { priority: -1, regions: [] },
      TL: { priority: -1, regions: [] },
      BR: { priority: -1, regions: [] },
      BL: { priority: -1, regions: [] },
    };

    rects.forEach ((r) =>  {
      if (!PackerUtils.isAnchored(r.constraints)) {
        ret.push (r);
      } else {
        const left = PackerUtils.hasAnchor(r.constraints, "left");
        const top = PackerUtils.hasAnchor(r.constraints, "top");
        const right = PackerUtils.hasAnchor(r.constraints, "right");

        if (left && top) {
          if (r.priority > corners.TL.priority) {
            ret.push(r);
            corners.TL.priority = r.priority;
            corners.TL.regions = r.valid;
          } else if (!PackerUtils.sameRegions(corners.TL.regions, r.valid)) {
            ret.push(r);
          }
        } else if (right && top) {
          if (r.priority > corners.TR.priority) {
            ret.push(r);
            corners.TR.priority = r.priority;
            corners.TR.regions = r.valid;
          } else if (!PackerUtils.sameRegions(corners.TR.regions, r.valid)) {
            ret.push(r);
          }
        } else {
          const bottom = PackerUtils.hasAnchor(r.constraints, "bottom");
          if (left && bottom) {
            if (r.priority > corners.BL.priority) {
              ret.push(r);
              corners.BL.priority = r.priority;
              corners.BL.regions = r.valid;
            } else if (!PackerUtils.sameRegions(corners.BL.regions, r.valid)) {
              ret.push(r);
            }
          } else if (right && bottom) {
            if (r.priority > corners.BR.priority) {
              ret.push(r);
              corners.BR.regions = r.valid;
              corners.BR.priority = r.priority;
            } else if (!PackerUtils.sameRegions(corners.BR.regions, r.valid)) {
              ret.push(r);
            }
          } else {
            ret.push(r);
          }
        }
      }
    });

    return ret;
  }

  /**
   * @return true if regions are the same size
   * @param r1
   * @param r2
   */
  public static sameRegions(r1, r2) {
    if (r1.length === 0 || r2.length > r1.length) {
      return false;
    }

    return _.intersection(r1, r2).length === r2.length;
  }

  /* -----------------------------------------------------------------
   */
  /**
   * @return true if meets device /region constraints
   * @param validlist
   * @param rect
   */
  public static validRegion(validlist, rect): boolean {
    return _.contains(validlist, rect.regionId) || _.contains(validlist, rect.deviceId);
  }

  /**
   * @return bounding box for rectangle placement
   * @param rect
   * @param bbox
   * @param anchored
   * @param reduction - factor
   * @param constraints
   */
  public static computeBounds(rect, bbox, anchored: boolean, reduction: number, constraints = rect.constraints) {
    let x0 = -1;
    let y0 = -1;
    let x1 = -1;
    let y1 = -1;
    let cx = -1;
    let cy = -1;

    if (anchored) {
      if (PackerUtils.hasAnchor(constraints, "left")) {
        x0 = 0;
      }

      if (PackerUtils.hasAnchor(constraints, "right")) {
        x1 = bbox.x0 + bbox.width * reduction;
      }

      if (PackerUtils.hasAnchor(constraints, "top")) {
        y0 = 0;
      }

      if (PackerUtils.hasAnchor(constraints, "bottom")) {
        y1 = bbox.y0 + bbox.height * reduction;
      }

      if (PackerUtils.hasAnchor(rect, "vcenter")) {
        cy = bbox.boundingHeight / 2;
      }

      if (PackerUtils.hasAnchor(rect, "hcenter")) {
        cx = bbox.boundingWidth * 2;
      }
    }

    return {
      boundingWidth: bbox.boundingWidth,
      boundingHeight: bbox.boundingHeight,
      width: bbox.boundingWidth * reduction,
      height: bbox.boundingHeight * reduction,
      boundingX0: x0,
      boundingY0: y0,
      boundingX1: x1,
      boundingY1: y1,
      centerX: cx,
      centerY: cy,
    };
  }

  /**
   * if component dependencies are defined, all dependent component ids need to already have been placed in layout
   * todo: accommodate mixed communal & personal contexts
   * @param rect
   * @param placedRects
   */
  public static packedDependencies(rect, placedRects) {
    if (_.isEmpty(rect.constraints.dependencies)) {
      return true;
    }

    let retVal = true ;
    rect.constraints.dependencies.forEach((compDep) => {
      if (!_.contains (placedRects, compDep)) {
        retVal = false;
      }
    });

    return retVal ;
  }

  /* -----------------------------------------------------------------
   * anchoring utilites
   */
  /**
   * @return if the rect meets the anchoring constraints
   * @param constraints
   * @param rect
   */
  public static meetsAnchorConstraints(constraints: ILayoutConstraint, rect: PackerRectangle): boolean {
    if (! constraints.hasOwnProperty("anchor")) {
      return true;
    }

    if (_.contains(constraints.anchor, "left") && rect.x0 > 0) {
      return false;
    }

    if (_.contains(constraints.anchor, "top") &&  rect.y0 > 0) {
      return false;
    }

    if (_.contains(constraints.anchor, "right") && ((rect.x0 + rect.width) < (rect.boundingWidth - Globals.packer.MinDimension))) {
      return false;
    }

    if (_.contains(constraints.anchor, "bottom") && ((rect.y0 + rect.height) < (rect.boundingHeight - Globals.packer.MinDimension))) {
      return false;
    }

    return true;
  }

  /**
   * @return true if must be anchored to the right of the region
   * @param constraints
   */
  public static isAnchored(constraints: ILayoutConstraint): boolean {
    return !isNullOrUndefined(constraints) && constraints.hasOwnProperty("anchor");
  }

  /**
   * @return true if must be anchored to the right of the region
   * @param constraints
   * @param anchor
   */
  public static hasAnchor(constraints: ILayoutConstraint, anchor: string): boolean {
    return _.contains (constraints.anchor, anchor);
  }

  /**
   * @return true if must be anchored to the right of the region
   * @param constraints
   */
  public static anchoredLeft(constraints: ILayoutConstraint): boolean {
    return PackerUtils.isAnchored(constraints) && PackerUtils.hasAnchor(constraints, "left");
  }

  /**
   * @return true if must be anchored to the right of the region
   * @param constraints
   */
  public static anchoredTop(constraints: ILayoutConstraint): boolean {
    return PackerUtils.isAnchored(constraints) && PackerUtils.hasAnchor(constraints, "top");
  }

  /**
   * @return true if must be anchored to the right of the region
   * @param constraints
   */
  public static anchoredRight(constraints: ILayoutConstraint): boolean {
    return PackerUtils.isAnchored(constraints) && PackerUtils.hasAnchor(constraints, "right");
  }

  /**
   * @return true if must be anchored to the bottom of the region
   * @param constraints
   */
  public static anchoredBottom(constraints: ILayoutConstraint): boolean {
    return PackerUtils.isAnchored(constraints) && PackerUtils.hasAnchor(constraints, "bottom");
  }

  /**
   * @return true if constraints have vertically centered anchor
   * @param constraints
   */
  public static anchoredVCenter(constraints: ILayoutConstraint): boolean {
    return PackerUtils.isAnchored(constraints) && PackerUtils.hasAnchor(constraints, "vcenter");
  }

  /* ----------------------------------------------------------
   * check for fit when packing
   */
  /**
   * @return true if rect smaller or equal to the node size
   * @param rect
   * @param node
   */
  public static fitsIn(rect: PackerRectangle, node: PackerNode): boolean {
    return rect.width <= node.rect.width && rect.height <= node.rect.height;
  }

  /**
   * @return true if smallest fit possible
   * @param rect
   * @param node
   */
  public static fitsExactly(rect: PackerRectangle, node: PackerNode): boolean {
    return rect.width <= node.rect.width && rect.width >= (node.rect.width - Globals.packer.MinDimension)
        && rect.height <= node.rect.height && rect.height >= (node.rect.height - Globals.packer.MinDimension);
  }

  /**
   * @return true if a rectangle is centered vertically or horizontally within it's bounding box
   * @param rect
   * @param direction
   */
  public static centered(rect: PackerRectangle, direction: string): boolean {
    if (direction === "vertical") {
      const midpt = rect.boundingHeight / 2;
      return ((rect.y0 + rect.height < midpt) || (rect.y0 > midpt)) ? false : true;
    } else {
      const midpt = rect.boundingWidth / 2;
      return  ((rect.x0 + rect.width < midpt) || (rect.x0 > midpt)) ? false : true;
    }
  }

  /**
   * uppdate rectangle to reflect placement
   * @param item
   * @param rectlist
   */
  public static updateRect(item: Node, rectlist) {
    let orig = item;
    if (orig.occupiedBy == null) {
      orig = item.child[0];
    }

    for (const rect of rectlist) {
      if (rect.componentId === orig.occupiedBy) {
        rect.x0 = orig.rect.x0;
        rect.y0 = orig.rect.y0;
        rect.width = orig.rect.width;
        rect.height = orig.rect.height;
        rect.deviceId = orig.rect.deviceId;
        rect.regionId = orig.rect.regionId;
        break;
      }
    }
  }

  /**
   * @return true if top left ordering is preserved
   * @param nodes
   */
  public static orderedTopLeft(nodes: Node[]): boolean {
    if (nodes.length < 2) {
      return true;
    }

    let ws = false;
    nodes.sort ((a, b) => {
      return PackerUtils.topleft(a.rect, b.rect);
    });
    for (const n in nodes) {
      const node = nodes[n];
      if (node.occupiedBy === null) {
        ws = true;
      } else if (ws) {
        return false;
      }
    }
    return true;
  }

  /* -------------------------------------------------------------------
   * pretty print results
   */
  public static  printLayout(logr, packed): void {
    if (!logr.isDebugEabled()) {
      return;
    }

    logr.debug(Logger.formatMessage("=========================================================================="));
    logr.debug(Logger.formatMessage("returning layout:"));
    logr.debug(Logger.formatMessage("layout packer placed: " + JSON.stringify(_.pluck(packed.rects, "componentId"))));
    logr.debug(Logger.formatMessage("layout packer doesnt fit: " + JSON.stringify(_.pluck(packed.notPlaced, "componentId"))));
    logr.debug(Logger.formatMessage("layout packer no device: " + JSON.stringify(_.pluck(packed.noDevice, "componentId"))));
    logr.debug(Logger.formatMessage("layout packer missing dependency: " + JSON.stringify(_.pluck(packed.noDependent, "componentId"))));
    logr.debug(Logger.formatMessage("layout packer returned:" + JSON.stringify(packed.rects)));
    logr.debug(Logger.formatMessage("========================================================================="));
  }
}
