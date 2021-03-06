// Generated by typings
// Source: https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/80060c94ef549c077a011977c2b5461bd0fd8947/express-mung/index.d.ts
declare module "express-mung" {
    import { Request, Response } from "express";
    import * as http from "http";

    type Transform = (body: {}, request: Request, response: Response) => any;
    type TransformHeader = (body: http.IncomingMessage, request: Request, response: Response) => any;

    /**
     * Transform the JSON body of the response.
     * @param {Transform} fn A transformation function.
     * @return {any} The body.
     */
    export function json(fn: Transform): any;

    /**
     * Transform the JSON body of the response.
     * @param {Transform} fn A transformation function.
     * @return {any} The body.
     */
    export function jsonAsync(fn: Transform): PromiseLike<any>;

    /**
     * Transform the HTTP headers of the response.
     * @param {Transform} fn A transformation function.
     * @return {any} The body.
     */
    export function headers(fn: TransformHeader): any;

    /**
     * Transform the HTTP headers of the response.
     * @param {Transform} fn A transformation function.
     * @return {any} The body.
     */
    export function headersAsync(fn: TransformHeader): PromiseLike<any>;
}
