/**
 * Copyright (c) 2019, WSO2 Inc. (http://www.wso2.org) All Rights Reserved.
 *
 * WSO2 Inc. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { ID_TOKEN } from "../constants";
import { ConfigInterface } from "../models/client";
import { getEndSessionEndpoint, resetOPConfiguration } from "./op-config";
import { endAuthenticatedSession, getSessionParameter } from "./session";

/**
 * Execute user sign out request
 *
 * @param {object} requestParams
 * @param {function} callback
 * @returns {Promise<any>} sign out request status
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const sendSignOutRequest =  (requestParams: ConfigInterface, callback?: () => void): Promise<any> => {
    const logoutEndpoint = getEndSessionEndpoint();

    if (!logoutEndpoint || logoutEndpoint.trim().length === 0) {
        return Promise.reject(new Error("Invalid logout endpoint found."));
    }

    const idToken = getSessionParameter(ID_TOKEN);

    if (!idToken || idToken.trim().length === 0) {
        return Promise.reject(new Error("Invalid id_token found."));
    }

    endAuthenticatedSession();
    resetOPConfiguration();

    if (callback) {
        callback();
    }

    window.location.href = `${logoutEndpoint}?` + `id_token_hint=${idToken}` +
        `&post_logout_redirect_uri=${requestParams.callbackURL}`;
};

/**
 * Handle sign out requests
 *
 * @param {object} requestParams
 * @param {function} callback
 * @returns {Promise<any>} sign out status
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const handleSignOut = (requestParams: ConfigInterface, callback?: () => void): Promise<any> => {
    if (sessionStorage.length === 0) {
        return Promise.reject(new Error("No login sessions."));
    } else {
        return sendSignOutRequest(requestParams, callback)
            .catch((error) => {
                // TODO: Handle error
                throw error;
            });
    }
};
