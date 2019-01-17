#  Copyright 2018 Cisco and/or its affiliates
#
#    Licensed under the Apache License, Version 2.0 (the "License");
#    you may not use this file except in compliance with the License.
#    You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
#    Unless required by applicable law or agreed to in writing, software
#    distributed under the License is distributed on an "AS IS" BASIS,
#    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#    See the License for the specific language governing permissions and
#    limitations under the License.
#
FROM node:9-alpine AS build

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN apk add --no-cache git build-base yarn python \
    && yarn install \
    && NODE_ENV=production ./node_modules/typescript/bin/tsc

FROM node:9-alpine
LABEL maintainer "Harry Walter <harwalte@cisco.com>"

ENV NODE_ENV production

WORKDIR /usr/src/app

# Copy application
COPY --from=build /usr/src/app/dist/ /usr/src/app
COPY api/ /usr/src/api

# Copy supporting files
COPY .yarnclean /usr/src/app/
COPY package.json /usr/src/app/
COPY yarn.lock /usr/src/app/

# Install deps
RUN apk add --no-cache tini ca-certificates \
    && apk add --no-cache --virtual .build-deps git build-base python yarn \
    && yarn install \
    && apk del --no-cache .build-deps

EXPOSE 3000

ENTRYPOINT ["tini", "--", "node", "main.js"]
