import { Construct } from 'constructs';
import { UserPoolIdentityProviderProps } from './base';
import { UserPoolIdentityProviderBase } from './private/user-pool-idp-base';
import { Names, Token } from '../../../core';
import { ValidationError } from '../../../core/lib/errors';
import { addConstructMetadata } from '../../../core/lib/metadata-resource';
import { propertyInjectable } from '../../../core/lib/prop-injectable';
import { CfnUserPoolIdentityProvider } from '../cognito.generated';

/**
 * Properties to initialize UserPoolIdentityProviderSaml.
 */
export interface UserPoolIdentityProviderSamlProps extends UserPoolIdentityProviderProps {
  /**
   * The name of the provider. Must be between 3 and 32 characters.
   *
   * @default - the unique ID of the construct
   */
  readonly name?: string;

  /**
   * Identifiers
   *
   * Identifiers can be used to redirect users to the correct IdP in multitenant apps.
   *
   * @default - no identifiers used
   */
  readonly identifiers?: string[];

  /**
   * The SAML metadata.
   */
  readonly metadata: UserPoolIdentityProviderSamlMetadata;

  /**
   * Whether to enable the "Sign-out flow" feature.
   *
   * @default - false
   */
  readonly idpSignout?: boolean;

  /**
   * Whether to require encrypted SAML assertions from IdP.
   *
   * @see https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-SAML-signing-encryption.html#cognito-user-pools-SAML-encryption
   *
   * @default false
   */
  readonly encryptedResponses?: boolean;

  /**
   * The signing algorithm for SAML requests.
   *
   * @see https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-SAML-signing-encryption.html#cognito-user-pools-SAML-signing
   *
   * @default - don't sign requests
   */
  readonly requestSigningAlgorithm?: SigningAlgorithm;

  /**
   * Whether to enable IdP-initiated SAML auth flows.
   *
   * @default false
   */
  readonly idpInitiated?: boolean;
}

/**
 * Signing algorithms for SAML requests.
 */
export enum SigningAlgorithm {
  /**
   * RSA with SHA-256.
   */
  RSA_SHA256 = 'rsa-sha256',
}

/**
 * Metadata types that can be used for a SAML user pool identity provider.
 */
export enum UserPoolIdentityProviderSamlMetadataType {
  /** Metadata provided via a URL. */
  URL = 'url',

  /** Metadata provided via the contents of a file. */
  FILE = 'file',
}

/**
 * Metadata for a SAML user pool identity provider.
 */
export class UserPoolIdentityProviderSamlMetadata {
  /**
   * Specify SAML metadata via a URL.
   */
  public static url(url: string): UserPoolIdentityProviderSamlMetadata {
    return new UserPoolIdentityProviderSamlMetadata(url, UserPoolIdentityProviderSamlMetadataType.URL);
  }

  /**
   * Specify SAML metadata via the contents of a file.
   */
  public static file(fileContent: string): UserPoolIdentityProviderSamlMetadata {
    return new UserPoolIdentityProviderSamlMetadata(fileContent, UserPoolIdentityProviderSamlMetadataType.FILE);
  }

  /**
   * Construct the metadata for a SAML identity provider.
   *
   * @param metadataContent A URL hosting SAML metadata, or the content of a file containing SAML metadata.
   * @param metadataType The type of metadata, either a URL or file content.
   */
  private constructor(public readonly metadataContent: string, public readonly metadataType: UserPoolIdentityProviderSamlMetadataType) {
  }
}

/**
 * Represents an identity provider that integrates with SAML.
 * @resource AWS::Cognito::UserPoolIdentityProvider
 */
@propertyInjectable
export class UserPoolIdentityProviderSaml extends UserPoolIdentityProviderBase {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-cognito.UserPoolIdentityProviderSaml';

  public readonly providerName: string;

  constructor(scope: Construct, id: string, props: UserPoolIdentityProviderSamlProps) {
    super(scope, id, props);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    this.validateName(props.name);

    const { metadataType, metadataContent } = props.metadata;

    const resource = new CfnUserPoolIdentityProvider(this, 'Resource', {
      userPoolId: props.userPool.userPoolId,
      providerName: this.getProviderName(props.name),
      providerType: 'SAML',
      providerDetails: {
        IDPSignout: props.idpSignout ?? false,
        MetadataURL: metadataType === UserPoolIdentityProviderSamlMetadataType.URL ? metadataContent : undefined,
        MetadataFile: metadataType === UserPoolIdentityProviderSamlMetadataType.FILE ? metadataContent : undefined,
        EncryptedResponses: props.encryptedResponses ?? undefined,
        RequestSigningAlgorithm: props.requestSigningAlgorithm,
        IDPInit: props.idpInitiated ?? undefined,
      },
      idpIdentifiers: props.identifiers,
      attributeMapping: super.configureAttributeMapping(),
    });

    this.providerName = super.getResourceNameAttribute(resource.ref);
  }

  private getProviderName(name?: string): string {
    if (name) {
      this.validateName(name);
      return name;
    }

    const uniqueName = Names.uniqueResourceName(this, {
      maxLength: 32,
    });

    if (uniqueName.length < 3) {
      return `${uniqueName}saml`;
    }

    return uniqueName;
  }

  private validateName(name?: string) {
    if (name && !Token.isUnresolved(name) && (name.length < 3 || name.length > 32)) {
      throw new ValidationError(`Expected provider name to be between 3 and 32 characters, received ${name} (${name.length} characters)`, this);
    }
  }
}
