/**
 * Copyright (c) 2021, WSO2 Inc. (http://www.wso2.com).
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

import https, { Agent } from "https";
import axios, { AxiosInstance } from "axios";
import { AuthClientConfig } from "..";
import { DataLayer } from "../data";

export class HttpsClient<T> {

    private static httpsClient: HttpsClient<any>;
    private axiosInstance: AxiosInstance;
    private httpsAgent: Agent;
    private _dataLayer: DataLayer<T>;
    private _config: () => Promise<AuthClientConfig>;

    private constructor(dataLayer: DataLayer<T>) {

        this._dataLayer = dataLayer;
        this._config = async () => await this._dataLayer.getConfigData();
    }

    public static async getInstance(dataLayer: DataLayer<any>): Promise<HttpsClient<any>> {

        if (this.httpsClient) {
            return this.httpsClient;
        }

        this.httpsClient = new HttpsClient(dataLayer);
        const configData = await this.httpsClient._config();

        if (configData.certificate) {
            this.httpsClient.httpsAgent = new https.Agent({
                ca: configData.certificate
            });

            this.httpsClient.axiosInstance = axios.create({
                httpsAgent: this.httpsClient.httpsAgent,
                withCredentials: configData.sendCookiesInRequests
            });
        } else {
            this.httpsClient.axiosInstance = axios.create({
                withCredentials: configData.sendCookiesInRequests
            });
        }

        return this.httpsClient;
    }

    public getAxios(): AxiosInstance {

        return this.axiosInstance;
    }

    public getHttpsAgent(): Agent {

        return this.httpsAgent;
    }
}
