/**
 * Copyright (c) 2020, WSO2 Inc. (http://www.wso2.org) All Rights Reserved.
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

import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import {
    AUTHORIZATION_ENDPOINT,
    OIDC_SCOPE,
    OP_CONFIG_INITIATED,
    PKCE_CODE_VERIFIER,
    SESSION_STATE,
    SIGN_OUT_SUCCESS_PARAM
} from "../constants";
import { DataLayer } from "../data";
import { AsgardeoAuthException, AsgardeoAuthNetworkException } from "../exception";
import { AuthenticationHelper } from "../helpers";
import { HttpsClient } from "../https-client/axios-https-client";
import {
    AuthClientConfig,
    AuthorizationURLParams,
    BasicUserInfo,
    CustomGrantConfig,
    DecodedIDTokenPayload,
    OIDCEndpoints,
    OIDCProviderMetaData,
    TokenResponse
} from "../models";
import { AuthenticationUtils, CryptoUtils } from "../utils";

export class AuthenticationCore<T> {
    private _dataLayer: DataLayer<T>;
    private _config: () => Promise<AuthClientConfig>;
    private _oidcProviderMetaData: () => Promise<OIDCProviderMetaData>;
    private _authenticationHelper: AuthenticationHelper<T>;
    private _httpsClient: () => Promise<HttpsClient<T>>;

    public constructor(dataLayer: DataLayer<T>) {
        this._authenticationHelper = new AuthenticationHelper(dataLayer);
        this._dataLayer = dataLayer;
        this._config = async () => await this._dataLayer.getConfigData();
        this._oidcProviderMetaData = async () => await this._dataLayer.getOIDCProviderMetaData();
        this._httpsClient = async () => await HttpsClient.getInstance(this._dataLayer);
    }

    public async getAuthorizationURL(config?: AuthorizationURLParams): Promise<string> {
        const authorizeEndpoint = (await this._dataLayer.getOIDCProviderMetaDataParameter(
            AUTHORIZATION_ENDPOINT
        )) as string;

        const configData = await this._config();

        if (!authorizeEndpoint || authorizeEndpoint.trim().length === 0) {
            throw new AsgardeoAuthException(
                "AUTH_CORE-GAU-NF01",
                "authentication-core",
                "getAuthorizationURL",
                "No authorization endpoint found.",
                "No authorization endpoint was found in the OIDC provider meta data from the well-known endpoint " +
                    "or the authorization endpoint passed to the SDK is empty."
            );
        }

        const authorizeRequest = new URL(authorizeEndpoint);

        authorizeRequest.searchParams.append("response_type", "code");
        authorizeRequest.searchParams.append("client_id", configData.clientID);

        let scope = OIDC_SCOPE;

        if (configData.scope && configData.scope.length > 0) {
            if (!configData.scope.includes(OIDC_SCOPE)) {
                configData.scope.push(OIDC_SCOPE);
            }
            scope = configData.scope.join(" ");
        }

        authorizeRequest.searchParams.append("scope", scope);
        authorizeRequest.searchParams.append("redirect_uri", configData.signInRedirectURL);

        if (configData.responseMode) {
             authorizeRequest.searchParams.append("response_mode", configData.responseMode);
        }

        if (configData.enablePKCE) {
            const codeVerifier = CryptoUtils.getCodeVerifier();
            const codeChallenge = CryptoUtils.getCodeChallenge(codeVerifier);
            await this._dataLayer.setTemporaryDataParameter(PKCE_CODE_VERIFIER, codeVerifier);
            authorizeRequest.searchParams.append("code_challenge_method", "S256");
            authorizeRequest.searchParams.append("code_challenge", codeChallenge);
        }

        if (configData.prompt) {
            authorizeRequest.searchParams.append("prompt", configData.prompt);
        }

        const customParams = config;
        if (customParams) {
            for (const [key, value] of Object.entries(customParams)) {
                if (key != "" && value != "") {
                    authorizeRequest.searchParams.append(key, value.toString());
                }
            }
        }

        return authorizeRequest.toString();
    }

    public async requestAccessToken(authorizationCode: string, sessionState: string): Promise<TokenResponse> {
        const tokenEndpoint = (await this._oidcProviderMetaData()).token_endpoint;
        const configData = await this._config();

        if (!tokenEndpoint || tokenEndpoint.trim().length === 0) {
            return Promise.reject(
                new AsgardeoAuthException(
                    "AUTH_CORE-RAT1-NF01",
                    "authentication-core",
                    "requestAccessToken",
                    "Token endpoint not found.",
                    "No token endpoint was found in the OIDC provider meta data returned by the well-known endpoint " +
                        "or the token endpoint passed to the SDK is empty."
                )
            );
        }

        sessionState && await this._dataLayer.setSessionDataParameter(SESSION_STATE, sessionState);

        const body: string[] = [];
        body.push(`client_id=${configData.clientID}`);

        if (configData.clientSecret && configData.clientSecret.trim().length > 0) {
            body.push(`client_secret=${configData.clientSecret}`);
        }

        const code = authorizationCode;
        body.push(`code=${code}`);

        body.push("grant_type=authorization_code");
        body.push(`redirect_uri=${configData.signInRedirectURL}`);

        if (configData.enablePKCE) {
            body.push(`code_verifier=${await this._dataLayer.getTemporaryDataParameter(PKCE_CODE_VERIFIER)}`);
            await this._dataLayer.removeTemporaryDataParameter(PKCE_CODE_VERIFIER);
        }

        const httpsClient = await this._httpsClient();

        return httpsClient.getAxios()
            .post(tokenEndpoint, body.join("&"), {
                headers: AuthenticationUtils.getTokenRequestHeaders(),
                withCredentials: configData.sendCookiesInRequests
            })
            .then((response) => {
                return this._authenticationHelper
                    .handleTokenResponse(response)
                    .then((response: TokenResponse) => response)
                    .catch((error) => {
                        return Promise.reject(
                            new AsgardeoAuthException(
                                "AUTH_CORE-RAT1-ES02",
                                "authentication-core",
                                "requestAccessToken",
                                undefined,
                                undefined,
                                error
                            )
                        );
                    });
            })
            .catch((error: AxiosError) => {
                return Promise.reject(
                    new AsgardeoAuthNetworkException(
                        "AUTH_CORE-RAT1-NR03",
                        "authentication-core",
                        "requestAccessToken",
                        "Requesting access token failed",
                        "The request to get the access token from the server failed.",
                        error?.code ?? "",
                        error?.message,
                        error?.response?.status,
                        error?.response?.data
                    )
                );
            });
    }

    public async refreshAccessToken(): Promise<TokenResponse> {
        const tokenEndpoint = (await this._oidcProviderMetaData()).token_endpoint;
        const configData = await this._config();
        const sessionData = await this._dataLayer.getSessionData();

        if (!sessionData.refresh_token) {
            return Promise.reject(
                new AsgardeoAuthException(
                    "AUTH_CORE-RAT2-NF01",
                    "authentication-core",
                    "refreshAccessToken",
                    "No refresh token found.",
                    "There was no refresh token found. Asgardeo doesn't return a " +
                        "refresh token if the refresh token grant is not enabled."
                )
            );
        }

        if (!tokenEndpoint || tokenEndpoint.trim().length === 0) {
            return Promise.reject(
                new AsgardeoAuthException(
                    "AUTH_CORE-RAT2-NF02",
                    "authentication-core",
                    "refreshAccessToken",
                    "No refresh token endpoint found.",
                    "No refresh token endpoint was in the OIDC provider meta data returned by the well-known " +
                        "endpoint or the refresh token endpoint passed to the SDK is empty."
                )
            );
        }

        const body: string[] = [];
        body.push(`client_id=${configData.clientID}`);
        body.push(`refresh_token=${sessionData.refresh_token}`);
        body.push("grant_type=refresh_token");

        if (configData.clientSecret && configData.clientSecret.trim().length > 0) {
            body.push(`client_secret=${configData.clientSecret}`);
        }

        const httpsClient = await this._httpsClient();

        return httpsClient.getAxios()
            .post(tokenEndpoint, body.join("&"), {
                headers: AuthenticationUtils.getTokenRequestHeaders(),
                withCredentials: configData.sendCookiesInRequests
            })
            .then((response) => {
                return this._authenticationHelper
                    .handleTokenResponse(response)
                    .then((response: TokenResponse) => response)
                    .catch((error) => {
                        return Promise.reject(
                            new AsgardeoAuthException(
                                "AUTH_CORE-RAT2-ES03",
                                "authentication-core",
                                "refreshAccessToken",
                                undefined,
                                undefined,
                                error
                            )
                        );
                    });
            })
            .catch((error: AxiosError) => {
                return Promise.reject(
                    new AsgardeoAuthNetworkException(
                        "AUTH_CORE-RAT2-NR03",
                        "authentication-core",
                        "refreshAccessToken",
                        "Refresh access token request failed.",
                        "The request to refresh the access token failed.",
                        error?.code ?? "",
                        error?.message,
                        error?.response?.status,
                        error?.response?.data
                    )
                );
            });
    }

    public async revokeAccessToken(): Promise<AxiosResponse> {
        const revokeTokenEndpoint = (await this._oidcProviderMetaData()).revocation_endpoint;
        const configData = await this._config();

        if (!revokeTokenEndpoint || revokeTokenEndpoint.trim().length === 0) {
            return Promise.reject(
                new AsgardeoAuthException(
                    "AUTH_CORE-RAT3-NF01",
                    "authentication-core",
                    "revokeAccessToken",
                    "No revoke access token endpoint found.",
                    "No revoke access token endpoint was found in the OIDC provider meta data returned by " +
                        "the well-known endpoint or the revoke access token endpoint passed to the SDK is empty."
                )
            );
        }

        const body: string[] = [];
        body.push(`client_id=${configData.clientID}`);
        body.push(`token=${(await this._dataLayer.getSessionData()).access_token}`);
        body.push("token_type_hint=access_token");

        const httpsClient = await this._httpsClient();

        return httpsClient.getAxios()
            .post(revokeTokenEndpoint, body.join("&"), {
                headers: AuthenticationUtils.getTokenRequestHeaders(),
                withCredentials: configData.sendCookiesInRequests
            })
            .then((response) => {
                if (response.status !== 200) {
                    return Promise.reject(
                        new AsgardeoAuthException(
                            "AUTH_CORE-RAT3-NR02",
                            "authentication-core",
                            "revokeAccessToken",
                            "Invalid response status received for revoke access token request.",
                            "The request sent to revoke the access token returned " +
                                response.status +
                                " , which is invalid."
                        )
                    );
                }

                this._authenticationHelper.clearUserSessionData();

                return Promise.resolve(response);
            })
            .catch((error: AxiosError) => {
                return Promise.reject(
                    new AsgardeoAuthNetworkException(
                        "AUTH_CORE-RAT3-NR03",
                        "authentication-core",
                        "revokeAccessToken",
                        "The request to revoke access token failed.",
                        "The request sent to revoke the access token failed.",
                        error?.code ?? "",
                        error?.message,
                        error?.response?.status,
                        error?.response?.data
                    )
                );
            });
    }

    public async requestCustomGrant(customGrantParams: CustomGrantConfig): Promise<TokenResponse | AxiosResponse> {
        const oidcProviderMetadata = await this._oidcProviderMetaData();
        const configData = await this._config();

        let tokenEndpoint;
        if (customGrantParams.tokenEndpoint && customGrantParams.tokenEndpoint.trim().length !== 0) {
            tokenEndpoint = customGrantParams.tokenEndpoint;
        } else {
            tokenEndpoint = oidcProviderMetadata.token_endpoint;
        }

        if (!tokenEndpoint || tokenEndpoint.trim().length === 0) {
            return Promise.reject(
                new AsgardeoAuthException(
                    "AUTH_CORE-RCG-NF01",
                    "authentication-core",
                    "requestCustomGrant",
                    "Token endpoint not found.",
                    "No token endpoint was found in the OIDC provider meta data returned by the well-known endpoint " +
                        "or the token endpoint passed to the SDK is empty."
                )
            );
        }


        const data: string[] = await Promise.all(Object.entries(customGrantParams.data)
            .map(async ([ key, value ]) => {
            const newValue = await this._authenticationHelper.replaceCustomGrantTemplateTags(value as string);
            return `${key}=${newValue}`;
        }));

        const httpsClient = await this._httpsClient();

        const requestConfig: AxiosRequestConfig = {
            data: data.join("&"),
            headers: {
                ...AuthenticationUtils.getTokenRequestHeaders()
            },
            method: "POST",
            url: tokenEndpoint,
            withCredentials: configData.sendCookiesInRequests,
            httpsAgent: httpsClient.getHttpsAgent()
        };

        if (customGrantParams.attachToken) {
            requestConfig.headers = {
                ...requestConfig.headers,
                Authorization: `Bearer ${(await this._dataLayer.getSessionData()).access_token}`
            };
        }

        return axios(requestConfig)
            .then(
                (response: AxiosResponse): Promise<AxiosResponse | TokenResponse> => {
                    if (response.status !== 200) {
                        return Promise.reject(
                            new AsgardeoAuthException(
                                "AUTH_CORE-RCG-NR02",
                                "authentication-core",
                                "requestCustomGrant",
                                "Invalid response status received for the custom grant request.",
                                "The request sent to get the custom grant returned " +
                                    response.status +
                                    " , which is invalid."
                            )
                        );
                    }

                    if (customGrantParams.returnsSession) {
                        return this._authenticationHelper
                            .handleTokenResponse(response)
                            .then((response: TokenResponse) => response)
                            .catch((error) => {
                                return Promise.reject(
                                    new AsgardeoAuthException(
                                        "AUTH_CORE-RCG-ES03",
                                        "authentication-core",
                                        "requestCustomGrant",
                                        undefined,
                                        undefined,
                                        error
                                    )
                                );
                            });
                    } else {
                        return Promise.resolve(response);
                    }
                }
            )
            .catch((error: AxiosError) => {
                return Promise.reject(
                    new AsgardeoAuthNetworkException(
                        "AUTH_CORE-RCG-NR04",
                        "authentication-core",
                        "requestCustomGrant",
                        "The custom grant request failed.",
                        "The request sent to get the custom grant failed.",
                        error?.code ?? "",
                        error?.message,
                        error?.response?.status,
                        error?.response?.data
                    )
                );
            });
    }

    public async getBasicUserInfo(): Promise<BasicUserInfo> {
        const sessionData = await this._dataLayer.getSessionData();
        const authenticatedUser = AuthenticationUtils.getAuthenticatedUserInfo(sessionData?.id_token);

        let basicUserInfo: BasicUserInfo = {
            allowedScopes: sessionData.scope,
            sessionState: sessionData.session_state
        };

        Object.keys(authenticatedUser).forEach((key) => {
            if (
                authenticatedUser[key] === undefined ||
                authenticatedUser[key] === "" ||
                authenticatedUser[key] === null ) {
                delete authenticatedUser[key];
            }
        });

        basicUserInfo = { ...basicUserInfo, ...authenticatedUser };

        return basicUserInfo;
    }

    public async getDecodedIDToken(): Promise<DecodedIDTokenPayload> {
        const idToken = (await this._dataLayer.getSessionData()).id_token;
        const payload: DecodedIDTokenPayload = CryptoUtils.decodeIDToken(idToken);

        return payload;
    }

    public async getIDToken(): Promise<string> {
        return (await this._dataLayer.getSessionData()).id_token;
    }

    public async getOIDCProviderMetaData(forceInit: boolean): Promise<boolean> {
        if (!forceInit && await this._dataLayer.getTemporaryDataParameter(OP_CONFIG_INITIATED)) {
            return Promise.resolve(true);
        }

        const wellKnownEndpoint = await this._authenticationHelper.resolveWellKnownEndpoint();

        const httpsClient = await this._httpsClient();

        return httpsClient.getAxios()
            .get(wellKnownEndpoint)
            .then(async (response: { data: OIDCProviderMetaData; status: number }) => {
                if (response.status !== 200) {
                    return Promise.reject(
                        new AsgardeoAuthException(
                            "AUTH_CORE-GOPM-NR01",
                            "authentication-core",
                            "getOIDCProviderMetaData",
                            "Invalid response status received for OIDC provider meta data request.",
                            "The request sent to the well-known endpoint to get the OIDC provider meta data returned " +
                                response.status +
                                " , which is invalid."
                        )
                    );
                }

                await this._dataLayer.setOIDCProviderMetaData(
                    await this._authenticationHelper.resolveEndpoints(response.data)
                );
                await this._dataLayer.setTemporaryDataParameter(OP_CONFIG_INITIATED, true);

                return Promise.resolve(true);
            })
            .catch(async () => {
                await this._dataLayer.setOIDCProviderMetaData(
                    await this._authenticationHelper.resolveFallbackEndpoints()
                );
                await this._dataLayer.setTemporaryDataParameter(OP_CONFIG_INITIATED, true);

                return Promise.resolve(true);
            });
    }

    public async getOIDCServiceEndpoints(): Promise<OIDCEndpoints> {
        const oidcProviderMetaData = await this._oidcProviderMetaData();

        return {
            authorizationEndpoint: oidcProviderMetaData.authorization_endpoint,
            checkSessionIframe: oidcProviderMetaData.check_session_iframe,
            endSessionEndpoint: oidcProviderMetaData.end_session_endpoint,
            introspectionEndpoint: oidcProviderMetaData.introspection_endpoint,
            issuer: oidcProviderMetaData.issuer,
            jwksUri: oidcProviderMetaData.jwks_uri,
            registrationEndpoint: oidcProviderMetaData.registration_endpoint,
            revocationEndpoint: oidcProviderMetaData.revocation_endpoint,
            tokenEndpoint: oidcProviderMetaData.token_endpoint,
            userinfoEndpoint: oidcProviderMetaData.userinfo_endpoint,
            wellKnownEndpoint: await this._authenticationHelper.resolveWellKnownEndpoint()
        };
    }

    public async getSignOutURL(): Promise<string> {
        const logoutEndpoint = (await this._oidcProviderMetaData())?.end_session_endpoint;
        const configData = await this._config();

        if (!logoutEndpoint || logoutEndpoint.trim().length === 0) {
            throw new AsgardeoAuthException(
                "AUTH_CORE-GSOU-NF01",
                "authentication-core",
                "getSignOutURL",
                "Sign-out endpoint not found.",
                "No sign-out endpoint was found in the OIDC provider meta data returned by the well-known endpoint " +
                    "or the sign-out endpoint passed to the SDK is empty."
            );
        }

        const idToken = (await this._dataLayer.getSessionData())?.id_token;

        if (!idToken || idToken.trim().length === 0) {
            throw new AsgardeoAuthException(
                "AUTH_CORE-GSOU-NF02",
                "authentication-core",
                "getSignOutURL",
                "ID token not found.",
                "No ID token could be found. Either the session information is lost or you have not signed in."
            );
        }

        const callbackURL = configData?.signOutRedirectURL ?? configData?.signInRedirectURL;

        if (!callbackURL || callbackURL.trim().length === 0) {
            throw new AsgardeoAuthException(
                "AUTH_CORE-GSOU-NF03",
                "authentication-core",
                "getSignOutURL",
                "No sign-out redirect URL found.",
                "The sign-out redirect URL cannot be found or the URL passed to the SDK is empty. " +
                    "No sign-in redirect URL has been found either. "
            );
        }

        const logoutCallback =
            `${logoutEndpoint}?` +
            `id_token_hint=${idToken}` +
            `&post_logout_redirect_uri=${callbackURL}&state=` +
            SIGN_OUT_SUCCESS_PARAM;

        return logoutCallback;
    }

    public async signOut(): Promise<string> {
        const signOutURL = await this.getSignOutURL();
        this._authenticationHelper.clearUserSessionData();

        return signOutURL;
    }

    public async getAccessToken(): Promise<string> {
        return (await this._dataLayer.getSessionData())?.access_token;
    }

    public async isAuthenticated(): Promise<boolean> {
        return Boolean(await this.getAccessToken());
    }

    public async getPKCECode(): Promise<string> {
        return (await this._dataLayer.getTemporaryDataParameter(PKCE_CODE_VERIFIER)) as string;
    }

    public async setPKCECode(pkce: string): Promise<void> {
        return await this._dataLayer.setTemporaryDataParameter(PKCE_CODE_VERIFIER, pkce);
    }

    public async updateConfig(config: Partial<AuthClientConfig<T>>): Promise<void> {
        await this._dataLayer.setConfigData(config);

        if (config.overrideWellEndpointConfig) {
            config?.endpoints && (await this._dataLayer.setOIDCProviderMetaData(
                await this._authenticationHelper.resolveEndpoints({})
            ));
        } else if (config?.endpoints) {
            await this.getOIDCProviderMetaData(true);
        }
    }
}
