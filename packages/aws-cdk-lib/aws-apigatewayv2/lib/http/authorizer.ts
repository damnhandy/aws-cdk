import { Construct } from 'constructs';
import { IHttpApi } from './api';
import { IHttpRoute } from './route';
import { CfnAuthorizer } from '.././index';
import { Duration, Resource } from '../../../core';
import { ValidationError } from '../../../core/lib/errors';
import { addConstructMetadata } from '../../../core/lib/metadata-resource';
import { propertyInjectable } from '../../../core/lib/prop-injectable';
import { IAuthorizer } from '../common';

/**
 * Supported Authorizer types
 */
export enum HttpAuthorizerType {
  /** IAM Authorizer */
  IAM = 'AWS_IAM',

  /** JSON Web Tokens */
  JWT = 'JWT',

  /** Lambda Authorizer */
  LAMBDA = 'REQUEST',
}

/**
 * Payload format version for lambda authorizers
 * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html
 */
export enum AuthorizerPayloadVersion {
  /** Version 1.0 */
  VERSION_1_0 = '1.0',

  /** Version 2.0 */
  VERSION_2_0 = '2.0',
}

/**
 * Properties to initialize an instance of `HttpAuthorizer`.
 */
export interface HttpAuthorizerProps {
  /**
   * Name of the authorizer
   * @default - id of the HttpAuthorizer construct.
   */
  readonly authorizerName?: string;

  /**
   * HTTP Api to attach the authorizer to
   */
  readonly httpApi: IHttpApi;

  /**
   * The type of authorizer
   */
  readonly type: HttpAuthorizerType;

  /**
   * The identity source for which authorization is requested.
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigatewayv2-authorizer.html#cfn-apigatewayv2-authorizer-identitysource
   */
  readonly identitySource: string[];

  /**
   * A list of the intended recipients of the JWT.
   * A valid JWT must provide an aud that matches at least one entry in this list.
   * @default - required for JWT authorizer typess.
   */
  readonly jwtAudience?: string[];

  /**
   * The base domain of the identity provider that issues JWT.
   * @default - required for JWT authorizer types.
   */
  readonly jwtIssuer?: string;

  /**
   * Specifies whether a Lambda authorizer returns a response in a simple format.
   *
   * If enabled, the Lambda authorizer can return a boolean value instead of an IAM policy.
   *
   * @default - The lambda authorizer must return an IAM policy as its response
   */
  readonly enableSimpleResponses?: boolean;

  /**
   * Specifies the format of the payload sent to an HTTP API Lambda authorizer.
   *
   * @default AuthorizerPayloadVersion.VERSION_2_0 if the authorizer type is HttpAuthorizerType.LAMBDA
   */
  readonly payloadFormatVersion?: AuthorizerPayloadVersion;

  /**
   * The authorizer's Uniform Resource Identifier (URI).
   *
   * For REQUEST authorizers, this must be a well-formed Lambda function URI.
   *
   * @default - required for Request authorizer types
   */
  readonly authorizerUri?: string;

  /**
   * How long APIGateway should cache the results. Max 1 hour.
   *
   * @default - API Gateway will not cache authorizer responses
   */
  readonly resultsCacheTtl?: Duration;
}

/**
 * An authorizer for HTTP APIs
 */
export interface IHttpAuthorizer extends IAuthorizer {
}

/**
 * Reference to an http authorizer
 */
export interface HttpAuthorizerAttributes {
  /**
   * Id of the Authorizer
   */
  readonly authorizerId: string;

  /**
   * Type of authorizer
   *
   * Possible values are:
   * - JWT - JSON Web Token Authorizer
   * - CUSTOM - Lambda Authorizer
   * - NONE - No Authorization
   */
  readonly authorizerType: string;
}

/**
 * An authorizer for Http Apis
 * @resource AWS::ApiGatewayV2::Authorizer
 */
@propertyInjectable
export class HttpAuthorizer extends Resource implements IHttpAuthorizer {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-apigatewayv2.HttpAuthorizer';

  /**
   * Import an existing HTTP Authorizer into this CDK app.
   */
  public static fromHttpAuthorizerAttributes(scope: Construct, id: string, attrs: HttpAuthorizerAttributes): IHttpRouteAuthorizer {
    class Import extends Resource implements IHttpRouteAuthorizer {
      public readonly authorizerId = attrs.authorizerId;
      public readonly authorizerType = attrs.authorizerType;

      public bind(): HttpRouteAuthorizerConfig {
        return {
          authorizerId: attrs.authorizerId,
          authorizationType: attrs.authorizerType,
        };
      }
    }
    return new Import(scope, id);
  }

  public readonly authorizerId: string;

  constructor(scope: Construct, id: string, props: HttpAuthorizerProps) {
    super(scope, id);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    let authorizerPayloadFormatVersion = props.payloadFormatVersion;

    if (props.type === HttpAuthorizerType.JWT && (!props.jwtAudience || props.jwtAudience.length === 0 || !props.jwtIssuer)) {
      throw new ValidationError('jwtAudience and jwtIssuer are mandatory for JWT authorizers', scope);
    }

    if (props.type === HttpAuthorizerType.LAMBDA && !props.authorizerUri) {
      throw new ValidationError('authorizerUri is mandatory for Lambda authorizers', scope);
    }

    /**
     * This check is required because Cloudformation will fail stack creation if this property
     * is set for the JWT authorizer. AuthorizerPayloadFormatVersion can only be set for REQUEST authorizer
     */
    if (props.type === HttpAuthorizerType.LAMBDA && typeof authorizerPayloadFormatVersion === 'undefined') {
      authorizerPayloadFormatVersion = AuthorizerPayloadVersion.VERSION_2_0;
    }

    const resource = new CfnAuthorizer(this, 'Resource', {
      name: props.authorizerName ?? id,
      apiId: props.httpApi.apiId,
      authorizerType: props.type,
      identitySource: props.identitySource,
      jwtConfiguration: undefinedIfNoKeys({
        audience: props.jwtAudience,
        issuer: props.jwtIssuer,
      }),
      enableSimpleResponses: props.enableSimpleResponses,
      authorizerPayloadFormatVersion,
      authorizerUri: props.authorizerUri,
      authorizerResultTtlInSeconds: props.resultsCacheTtl?.toSeconds(),
    });

    this.authorizerId = resource.ref;
  }
}

/**
 * Input to the bind() operation, that binds an authorizer to a route.
 */
export interface HttpRouteAuthorizerBindOptions {
  /**
   * The route to which the authorizer is being bound.
   */
  readonly route: IHttpRoute;
  /**
   * The scope for any constructs created as part of the bind.
   */
  readonly scope: Construct;
}

/**
 * Results of binding an authorizer to an http route.
 */
export interface HttpRouteAuthorizerConfig {
  /**
   * The authorizer id
   *
   * @default - No authorizer id (useful for AWS_IAM route authorizer)
   */
  readonly authorizerId?: string;

  /**
   * The type of authorization
   *
   * Possible values are:
   * - AWS_IAM - IAM Authorizer
   * - JWT - JSON Web Token Authorizer
   * - CUSTOM - Lambda Authorizer
   * - NONE - No Authorization
   */
  readonly authorizationType: string;

  /**
   * The list of OIDC scopes to include in the authorization.
   * @default - no authorization scopes
   */
  readonly authorizationScopes?: string[];
}

/**
 * An authorizer that can attach to an Http Route.
 */
export interface IHttpRouteAuthorizer {
  /**
   * Bind this authorizer to a specified Http route.
   */
  bind(options: HttpRouteAuthorizerBindOptions): HttpRouteAuthorizerConfig;
}

function undefinedIfNoKeys<A extends { [key: string]: unknown }>(obj: A): A | undefined {
  const allUndefined = Object.values(obj).every(val => val === undefined);
  return allUndefined ? undefined : obj;
}

/**
 * Explicitly configure no authorizers on specific HTTP API routes.
 */
export class HttpNoneAuthorizer implements IHttpRouteAuthorizer {
  /**
   * The authorizationType used for IAM Authorizer
   */
  public readonly authorizationType = 'NONE';
  public bind(_options: HttpRouteAuthorizerBindOptions): HttpRouteAuthorizerConfig {
    return {
      authorizationType: this.authorizationType,
    };
  }
}

