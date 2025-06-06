import { IConstruct, Construct } from 'constructs';
import { IApplicationListener } from './application-listener';
import { HttpCodeTarget } from './application-load-balancer';
import * as cloudwatch from '../../../aws-cloudwatch';
import * as ec2 from '../../../aws-ec2';
import { Aws, Annotations, Duration, Token } from '../../../core';
import { ValidationError } from '../../../core/lib/errors';
import { propertyInjectable } from '../../../core/lib/prop-injectable';
import { ApplicationELBMetrics } from '../elasticloadbalancingv2-canned-metrics.generated';
import {
  BaseTargetGroupProps, ITargetGroup, loadBalancerNameFromListenerArn, LoadBalancerTargetProps,
  TargetGroupAttributes, TargetGroupBase, TargetGroupImportProps,
} from '../shared/base-target-group';
import { ApplicationProtocol, ApplicationProtocolVersion, Protocol, TargetType, TargetGroupLoadBalancingAlgorithmType } from '../shared/enums';
import { ImportedTargetGroupBase } from '../shared/imported';
import { determineProtocolAndPort, parseLoadBalancerFullName, parseTargetGroupFullName } from '../shared/util';

/**
 * Properties for defining an Application Target Group
 */
export interface ApplicationTargetGroupProps extends BaseTargetGroupProps {
  /**
   * The protocol used for communication with the target.
   *
   * This is not applicable for Lambda targets.
   *
   * @default - Determined from port if known
   */
  readonly protocol?: ApplicationProtocol;

  /**
   * The protocol version to use
   *
   * @default ApplicationProtocolVersion.HTTP1
   */
  readonly protocolVersion?: ApplicationProtocolVersion;

  /**
   * The port on which the target receives traffic.
   *
   * This is not applicable for Lambda targets.
   *
   * @default - Determined from protocol if known
   */
  readonly port?: number;

  /**
   * The time period during which the load balancer sends a newly registered
   * target a linearly increasing share of the traffic to the target group.
   *
   * The range is 30-900 seconds (15 minutes).
   *
   * @default 0
   */
  readonly slowStart?: Duration;

  /**
   * The stickiness cookie expiration period.
   *
   * Setting this value enables load balancer stickiness.
   *
   * After this period, the cookie is considered stale. The minimum value is
   * 1 second and the maximum value is 7 days (604800 seconds).
   *
   * @default - Stickiness is disabled
   */
  readonly stickinessCookieDuration?: Duration;

  /**
   * The name of an application-based stickiness cookie.
   *
   * Names that start with the following prefixes are not allowed: AWSALB, AWSALBAPP,
   * and AWSALBTG; they're reserved for use by the load balancer.
   *
   * Note: `stickinessCookieName` parameter depends on the presence of `stickinessCookieDuration` parameter.
   * If `stickinessCookieDuration` is not set, `stickinessCookieName` will be omitted.
   *
   * @default - If `stickinessCookieDuration` is set, a load-balancer generated cookie is used. Otherwise, no stickiness is defined.
   * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/application/sticky-sessions.html
   */
  readonly stickinessCookieName?: string;

  /**
   * The load balancing algorithm to select targets for routing requests.
   *
   * @default TargetGroupLoadBalancingAlgorithmType.ROUND_ROBIN
   */
  readonly loadBalancingAlgorithmType?: TargetGroupLoadBalancingAlgorithmType;

  /**
   * The targets to add to this target group.
   *
   * Can be `Instance`, `IPAddress`, or any self-registering load balancing
   * target. If you use either `Instance` or `IPAddress` as targets, all
   * target must be of the same type.
   *
   * @default - No targets.
   */
  readonly targets?: IApplicationLoadBalancerTarget[];

  /**
   * Indicates whether anomaly mitigation is enabled.
   *
   * Only available when `loadBalancingAlgorithmType` is `TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM`
   *
   * @default false
   *
   * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html#automatic-target-weights
   */
  readonly enableAnomalyMitigation?: boolean;

  /**
   * Indicates whether the target group supports multi-value headers.
   *
   * If the value is true, the request and response headers exchanged between
   * the load balancer and the Lambda function include arrays of values or strings.
   *
   * Only applicable for Lambda targets.
   *
   * @default false
   *
   * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html#target-group-attributes
   */
  readonly multiValueHeadersEnabled?: boolean;
}

/**
 * Contains all metrics for a Target Group of a Application Load Balancer.
 */
export interface IApplicationTargetGroupMetrics {
  /**
   * Return the given named metric for this Network Target Group
   *
   * @default Average over 5 minutes
   */
  custom(metricName: string, props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of IPv6 requests received by the target group
   *
   * @default Sum over 5 minutes
   */
  ipv6RequestCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of requests processed over IPv4 and IPv6.
   *
   * This count includes only the requests with a response generated by a target of the load balancer.
   *
   * @default Sum over 5 minutes
   */
  requestCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of healthy hosts in the target group
   *
   * @default Average over 5 minutes
   */
  healthyHostCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of unhealthy hosts in the target group
   *
   * @default Average over 5 minutes
   */
  unhealthyHostCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of HTTP 2xx/3xx/4xx/5xx response codes generated by all targets in this target group.
   *
   * This does not include any response codes generated by the load balancer.
   *
   * @default Sum over 5 minutes
   */
  httpCodeTarget(code: HttpCodeTarget, props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The average number of requests received by each target in a target group.
   *
   * The only valid statistic is Sum. Note that this represents the average not the sum.
   *
   * @default Sum over 5 minutes
   */
  requestCountPerTarget(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of connections that were not successfully established between the load balancer and target.
   *
   * @default Sum over 5 minutes
   */
  targetConnectionErrorCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The time elapsed, in seconds, after the request leaves the load balancer until a response from the target is received.
   *
   * @default Average over 5 minutes
   */
  targetResponseTime(props?: cloudwatch.MetricOptions): cloudwatch.Metric;

  /**
   * The number of TLS connections initiated by the load balancer that did not establish a session with the target.
   *
   * Possible causes include a mismatch of ciphers or protocols.
   *
   * @default Sum over 5 minutes
   */
  targetTLSNegotiationErrorCount(props?: cloudwatch.MetricOptions): cloudwatch.Metric;
}

/**
 * The metrics for a Application Load Balancer.
 */
class ApplicationTargetGroupMetrics implements IApplicationTargetGroupMetrics {
  private readonly scope: Construct;
  private readonly loadBalancerFullName: string;
  private readonly targetGroupFullName: string;

  public constructor(scope: Construct, targetGroupFullName: string, loadBalancerFullName: string) {
    this.scope = scope;
    this.targetGroupFullName = targetGroupFullName;
    this.loadBalancerFullName = loadBalancerFullName;
  }

  public custom(metricName: string, props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName,
      dimensionsMap: {
        TargetGroup: this.targetGroupFullName,
        LoadBalancer: this.loadBalancerFullName,
      },
      ...props,
    }).attachTo(this.scope);
  }

  public ipv6RequestCount(props?: cloudwatch.MetricOptions) {
    return this.cannedMetric(ApplicationELBMetrics.iPv6RequestCountSum, props);
  }

  public requestCount(props?: cloudwatch.MetricOptions) {
    return this.cannedMetric(ApplicationELBMetrics.requestCountSum, props);
  }

  public healthyHostCount(props?: cloudwatch.MetricOptions) {
    return this.custom('HealthyHostCount', {
      statistic: 'Average',
      ...props,
    });
  }

  public unhealthyHostCount(props?: cloudwatch.MetricOptions) {
    return this.custom('UnHealthyHostCount', {
      statistic: 'Average',
      ...props,
    });
  }

  public httpCodeTarget(code: HttpCodeTarget, props?: cloudwatch.MetricOptions) {
    return this.custom(code, {
      statistic: 'Sum',
      ...props,
    });
  }

  public requestCountPerTarget(props?: cloudwatch.MetricOptions) {
    return this.custom('RequestCountPerTarget', {
      statistic: 'Sum',
      ...props,
    });
  }

  public targetConnectionErrorCount(props?: cloudwatch.MetricOptions) {
    return this.custom('TargetConnectionErrorCount', {
      statistic: 'Sum',
      ...props,
    });
  }

  public targetResponseTime(props?: cloudwatch.MetricOptions) {
    return this.custom('TargetResponseTime', {
      statistic: 'Average',
      ...props,
    });
  }

  public targetTLSNegotiationErrorCount(props?: cloudwatch.MetricOptions) {
    return this.custom('TargetTLSNegotiationErrorCount', {
      statistic: 'Sum',
      ...props,
    });
  }

  private cannedMetric(
    fn: (dims: { LoadBalancer: string; TargetGroup: string }) => cloudwatch.MetricProps,
    props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    return new cloudwatch.Metric({
      ...fn({
        LoadBalancer: this.loadBalancerFullName,
        TargetGroup: this.targetGroupFullName,
      }),
      ...props,
    }).attachTo(this.scope);
  }
}

/**
 * Define an Application Target Group
 */
@propertyInjectable
export class ApplicationTargetGroup extends TargetGroupBase implements IApplicationTargetGroup {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-elasticloadbalancingv2.ApplicationTargetGroup';

  /**
   * Import an existing target group
   */
  public static fromTargetGroupAttributes(scope: Construct, id: string, attrs: TargetGroupAttributes): IApplicationTargetGroup {
    return new ImportedApplicationTargetGroup(scope, id, attrs);
  }

  /**
   * Import an existing target group
   *
   * @deprecated Use `fromTargetGroupAttributes` instead
   */
  public static import(scope: Construct, id: string, props: TargetGroupImportProps): IApplicationTargetGroup {
    return ApplicationTargetGroup.fromTargetGroupAttributes(scope, id, props);
  }

  private readonly connectableMembers: ConnectableMember[];
  private readonly listeners: IApplicationListener[];
  private readonly protocol?: ApplicationProtocol;
  private readonly port?: number;
  private _metrics?: IApplicationTargetGroupMetrics;

  constructor(scope: Construct, id: string, props: ApplicationTargetGroupProps = {}) {
    const [protocol, port] = determineProtocolAndPort(props.protocol, props.port);
    const { protocolVersion } = props;
    super(scope, id, { ...props }, {
      protocol,
      protocolVersion,
      port,
    });

    this.protocol = protocol;
    this.port = port;

    // this.targetType is lazy
    this.node.addValidation({
      validate: () => {
        if (this.targetType === TargetType.LAMBDA && (this.port || this.protocol)) {
          return ['port/protocol should not be specified for Lambda targets'];
        } else {
          return [];
        }
      },
    });

    this.connectableMembers = [];
    this.listeners = [];

    if (props) {
      const isWeightedRandomAlgorithm = !Token.isUnresolved(props.loadBalancingAlgorithmType) &&
        (props.loadBalancingAlgorithmType === TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM);

      if (props.slowStart !== undefined) {
        // 0 is allowed and disables slow start
        if ((props.slowStart.toSeconds() < 30 && props.slowStart.toSeconds() !== 0) || props.slowStart.toSeconds() > 900) {
          throw new ValidationError('Slow start duration value must be between 30 and 900 seconds, or 0 to disable slow start.', this);
        }
        this.setAttribute('slow_start.duration_seconds', props.slowStart.toSeconds().toString());

        if (isWeightedRandomAlgorithm) {
          throw new ValidationError('The weighted random routing algorithm can not be used with slow start mode.', this);
        }
      }

      if (props.stickinessCookieDuration) {
        this.enableCookieStickiness(props.stickinessCookieDuration, props.stickinessCookieName);
      } else {
        this.setAttribute('stickiness.enabled', 'false');
      }

      if (props.loadBalancingAlgorithmType) {
        this.setAttribute('load_balancing.algorithm.type', props.loadBalancingAlgorithmType);
      }

      if (props.multiValueHeadersEnabled) {
        if (this.targetType === TargetType.LAMBDA) {
          this.setAttribute('lambda.multi_value_headers.enabled', 'true');
        } else {
          throw new ValidationError('multiValueHeadersEnabled is only supported for Lambda targets.', this);
        }
      }

      this.addTarget(...(props.targets || []));

      if (props.enableAnomalyMitigation !== undefined) {
        if (props.enableAnomalyMitigation && !isWeightedRandomAlgorithm) {
          throw new ValidationError('Anomaly mitigation is only available when `loadBalancingAlgorithmType` is `TargetGroupLoadBalancingAlgorithmType.WEIGHTED_RANDOM`.', this);
        }
        this.setAttribute('load_balancing.algorithm.anomaly_mitigation', props.enableAnomalyMitigation ? 'on' : 'off');
      }
    }
  }

  public get metrics(): IApplicationTargetGroupMetrics {
    if (!this._metrics) {
      this._metrics = new ApplicationTargetGroupMetrics(this, this.targetGroupFullName, this.firstLoadBalancerFullName);
    }
    return this._metrics;
  }

  /**
   * Add a load balancing target to this target group
   */
  public addTarget(...targets: IApplicationLoadBalancerTarget[]) {
    for (const target of targets) {
      const result = target.attachToApplicationTargetGroup(this);
      this.addLoadBalancerTarget(result);
    }

    if (this.targetType === TargetType.LAMBDA) {
      this.setAttribute('stickiness.enabled', undefined);
    }
  }

  /**
   * Enable sticky routing via a cookie to members of this target group.
   *
   * Note: If the `cookieName` parameter is set, application-based stickiness will be applied,
   * otherwise it defaults to duration-based stickiness attributes (`lb_cookie`).
   *
   * @see https://docs.aws.amazon.com/elasticloadbalancing/latest/application/sticky-sessions.html
   */
  public enableCookieStickiness(duration: Duration, cookieName?: string) {
    if (duration.toSeconds() < 1 || duration.toSeconds() > 604800) {
      throw new ValidationError('Stickiness cookie duration value must be between 1 second and 7 days (604800 seconds).', this);
    }
    if (cookieName !== undefined) {
      if (!Token.isUnresolved(cookieName) && (cookieName.startsWith('AWSALB') || cookieName.startsWith('AWSALBAPP') || cookieName.startsWith('AWSALBTG'))) {
        throw new ValidationError('App cookie names that start with the following prefixes are not allowed: AWSALB, AWSALBAPP, and AWSALBTG; they\'re reserved for use by the load balancer.', this);
      }
      if (cookieName === '') {
        throw new ValidationError('App cookie name cannot be an empty string.', this);
      }
    }
    this.setAttribute('stickiness.enabled', 'true');
    if (cookieName) {
      this.setAttribute('stickiness.type', 'app_cookie');
      this.setAttribute('stickiness.app_cookie.cookie_name', cookieName);
      this.setAttribute('stickiness.app_cookie.duration_seconds', duration.toSeconds().toString());
    } else {
      this.setAttribute('stickiness.type', 'lb_cookie');
      this.setAttribute('stickiness.lb_cookie.duration_seconds', duration.toSeconds().toString());
    }
  }

  /**
   * Register a connectable as a member of this target group.
   *
   * Don't call this directly. It will be called by load balancing targets.
   */
  public registerConnectable(connectable: ec2.IConnectable, portRange?: ec2.Port) {
    portRange = portRange || ec2.Port.tcp(this.defaultPort);

    // Notify all listeners that we already know about of this new connectable.
    // Then remember for new listeners that might get added later.
    this.connectableMembers.push({ connectable, portRange });
    for (const listener of this.listeners) {
      listener.registerConnectable(connectable, portRange);
    }
  }

  /**
   * Register a listener that is load balancing to this target group.
   *
   * Don't call this directly. It will be called by listeners.
   */
  public registerListener(listener: IApplicationListener, associatingConstruct?: IConstruct) {
    // Notify this listener of all connectables that we know about.
    // Then remember for new connectables that might get added later.
    for (const member of this.connectableMembers) {
      listener.registerConnectable(member.connectable, member.portRange);
    }
    this.listeners.push(listener);
    this.loadBalancerAttachedDependencies.add(associatingConstruct ?? listener);
  }

  /**
   * Full name of first load balancer
   */
  public get firstLoadBalancerFullName(): string {
    if (this.listeners.length === 0) {
      throw new ValidationError('The TargetGroup needs to be attached to a LoadBalancer before you can call this method', this);
    }
    return loadBalancerNameFromListenerArn(this.listeners[0].listenerArn);
  }

  /**
   * Return the given named metric for this Application Load Balancer Target Group
   *
   * Returns the metric for this target group from the point of view of the first
   * load balancer load balancing to it. If you have multiple load balancers load
   * sending traffic to the same target group, you will have to override the dimensions
   * on this metric.
   *
   * @default Average over 5 minutes
   */
  public metric(metricName: string, props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    return this.metrics.custom(metricName, props);
  }

  /**
   * The number of IPv6 requests received by the target group
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``ApplicationTargetGroup.metrics.ipv6RequestCount`` instead
   */
  public metricIpv6RequestCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.ipv6RequestCount(props);
  }

  /**
   * The number of requests processed over IPv4 and IPv6.
   *
   * This count includes only the requests with a response generated by a target of the load balancer.
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``ApplicationTargetGroup.metrics.requestCount`` instead
   */
  public metricRequestCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.requestCount(props);
  }

  /**
   * The number of healthy hosts in the target group
   *
   * @default Average over 5 minutes
   * @deprecated Use ``ApplicationTargetGroup.metrics.healthyHostCount`` instead
   */
  public metricHealthyHostCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.healthyHostCount(props);
  }

  /**
   * The number of unhealthy hosts in the target group
   *
   * @default Average over 5 minutes
   * @deprecated Use ``ApplicationTargetGroup.metrics.unhealthyHostCount`` instead
   */
  public metricUnhealthyHostCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.unhealthyHostCount(props);
  }

  /**
   * The number of HTTP 2xx/3xx/4xx/5xx response codes generated by all targets in this target group.
   *
   * This does not include any response codes generated by the load balancer.
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``ApplicationTargetGroup.metrics.httpCodeTarget`` instead
   */
  public metricHttpCodeTarget(code: HttpCodeTarget, props?: cloudwatch.MetricOptions) {
    return this.metrics.httpCodeTarget(code, props);
  }

  /**
   * The average number of requests received by each target in a target group.
   *
   * The only valid statistic is Sum. Note that this represents the average not the sum.
   *
   * @default Sum over 5 minutes
   * @deprecated Use `ApplicationTargetGroup.metrics.requestCountPerTarget` instead
   */
  public metricRequestCountPerTarget(props?: cloudwatch.MetricOptions) {
    return this.metrics.requestCountPerTarget(props);
  }

  /**
   * The number of connections that were not successfully established between the load balancer and target.
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``ApplicationTargetGroup.metrics.targetConnectionErrorCount`` instead
   */
  public metricTargetConnectionErrorCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.targetConnectionErrorCount(props);
  }

  /**
   * The time elapsed, in seconds, after the request leaves the load balancer until a response from the target is received.
   *
   * @default Average over 5 minutes
   * @deprecated Use ``ApplicationTargetGroup.metrics.targetResponseTime`` instead
   */
  public metricTargetResponseTime(props?: cloudwatch.MetricOptions) {
    return this.metrics.targetResponseTime(props);
  }

  /**
   * The number of TLS connections initiated by the load balancer that did not establish a session with the target.
   *
   * Possible causes include a mismatch of ciphers or protocols.
   *
   * @default Sum over 5 minutes
   * @deprecated Use ``ApplicationTargetGroup.metrics.tlsNegotiationErrorCount`` instead
   */
  public metricTargetTLSNegotiationErrorCount(props?: cloudwatch.MetricOptions) {
    return this.metrics.targetTLSNegotiationErrorCount(props);
  }

  protected validateTargetGroup(): string[] {
    const ret = super.validateTargetGroup();

    if (this.targetType !== undefined && this.targetType !== TargetType.LAMBDA
      && (this.protocol === undefined || this.port === undefined)) {
      ret.push('At least one of \'port\' or \'protocol\' is required for a non-Lambda TargetGroup');
    }

    if (this.healthCheck) {
      if (this.healthCheck.interval && this.healthCheck.timeout &&
        this.healthCheck.interval.toMilliseconds() <= this.healthCheck.timeout.toMilliseconds()) {
        ret.push(`Healthcheck interval ${this.healthCheck.interval.toHumanString()} must be greater than the timeout ${this.healthCheck.timeout.toHumanString()}`);
      }

      if (this.healthCheck.protocol) {
        if (!ALB_HEALTH_CHECK_PROTOCOLS.includes(this.healthCheck.protocol)) {
          ret.push([
            `Health check protocol '${this.healthCheck.protocol}' is not supported. `,
            `Must be one of [${ALB_HEALTH_CHECK_PROTOCOLS.join(', ')}]`,
          ].join(''));
        }
      }
    }

    return ret;
  }
}

/**
 * A connectable member of a target group
 */
interface ConnectableMember {
  /**
   * The connectable member
   */
  connectable: ec2.IConnectable;

  /**
   * The port (range) the member is listening on
   */
  portRange: ec2.Port;
}

/**
 * A Target Group for Application Load Balancers
 */
export interface IApplicationTargetGroup extends ITargetGroup {
  /**
   * All metrics available for this target group.
   */
  readonly metrics: IApplicationTargetGroupMetrics;

  /**
   * Register a listener that is load balancing to this target group.
   *
   * Don't call this directly. It will be called by listeners.
   */
  registerListener(listener: IApplicationListener, associatingConstruct?: IConstruct): void;

  /**
   * Register a connectable as a member of this target group.
   *
   * Don't call this directly. It will be called by load balancing targets.
   */
  registerConnectable(connectable: ec2.IConnectable, portRange?: ec2.Port): void;

  /**
   * Add a load balancing target to this target group
   */
  addTarget(...targets: IApplicationLoadBalancerTarget[]): void;
}

/**
 * An imported application target group
 */
class ImportedApplicationTargetGroup extends ImportedTargetGroupBase implements IApplicationTargetGroup {
  private readonly _metrics?: IApplicationTargetGroupMetrics;

  public constructor(scope: Construct, id: string, props: TargetGroupAttributes) {
    super(scope, id, props);
    if (this.loadBalancerArns != Aws.NO_VALUE) {
      const targetGroupFullName = parseTargetGroupFullName(this.targetGroupArn);
      const firstLoadBalancerFullName = parseLoadBalancerFullName(this.loadBalancerArns);
      this._metrics = new ApplicationTargetGroupMetrics(this, targetGroupFullName, firstLoadBalancerFullName);
    }
  }

  public registerListener(_listener: IApplicationListener, _associatingConstruct?: IConstruct) {
    // Nothing to do, we know nothing of our members
    Annotations.of(this).addWarningV2('@aws-cdk/aws-elbv2:albTargetGroupCannotRegisterListener', 'Cannot register listener on imported target group -- security groups might need to be updated manually');
  }

  public registerConnectable(_connectable: ec2.IConnectable, _portRange?: ec2.Port | undefined): void {
    Annotations.of(this).addWarningV2('@aws-cdk/aws-elbv2:albTargetGroupCannotRegisterConnectable', 'Cannot register connectable on imported target group -- security groups might need to be updated manually');
  }

  public addTarget(...targets: IApplicationLoadBalancerTarget[]) {
    for (const target of targets) {
      const result = target.attachToApplicationTargetGroup(this);

      if (result.targetJson !== undefined) {
        throw new ValidationError('Cannot add a non-self registering target to an imported TargetGroup. Create a new TargetGroup instead.', this);
      }
    }
  }

  public get metrics(): IApplicationTargetGroupMetrics {
    if (!this._metrics) {
      throw new ValidationError(
        'The imported ApplicationTargetGroup needs the associated ApplicationBalancer to be able to provide metrics. ' +
        'Please specify the ARN value when importing it.', this);
    }
    return this._metrics;
  }
}

/**
 * Interface for constructs that can be targets of an application load balancer
 */
export interface IApplicationLoadBalancerTarget {
  /**
   * Attach load-balanced target to a TargetGroup
   *
   * May return JSON to directly add to the [Targets] list, or return undefined
   * if the target will register itself with the load balancer.
   */
  attachToApplicationTargetGroup(targetGroup: IApplicationTargetGroup): LoadBalancerTargetProps;
}

const ALB_HEALTH_CHECK_PROTOCOLS = [Protocol.HTTP, Protocol.HTTPS];
