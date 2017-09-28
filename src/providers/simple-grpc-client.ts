import { injectable, inject } from 'inversify';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { Config } from './../config';
import * as grpcExt from 'grpc/src/node/src/grpc_extension';
const connectivityState = grpcExt.connectivityState;

import { Context, Logger, ProtoConfig, HealthManager } from './..'

@injectable()
export class SimpleGrpcClient {
  public health = new BehaviorSubject(false);
  public protoConfig: ProtoConfig;
  public serviceAddress: string;
  public client;
  public grpc;
  public healthManager: HealthManager;
  public logger: Logger;
  public callTimeout = 5; // timeout/deadline for grpc calls in seconds
  private channelState = new BehaviorSubject(-1);

  constructor(config: Config) {
    if (config['grpcClientTimeout']) {
      this.callTimeout = config['grpcClientTimeout'];
    }
  }

  public connect() {
    this.healthManager.registerCheck(this.protoConfig.service, this.health);

    this.channelState.subscribe((state) => {
      this.health.next(state === connectivityState.READY)
    });

    // Load the proto and create service
    const proto = this.grpc.load(this.protoConfig.path);
    let ServiceClass;

    if (this.protoConfig.package) {
      ServiceClass = proto[this.protoConfig.package][this.protoConfig.service];
    } else {
      ServiceClass = proto[this.protoConfig.service];
    }

    this.client = new ServiceClass(this.serviceAddress, this.grpc.credentials.createInsecure());

    // Wiat for client to be ready and start health monitoring
    this.client.waitForReady(Infinity, (error) => {
      if (!error) {
        this.health.next(true);
        this.monitorGRPCHealth(connectivityState.READY);
      } else {
        // This should be really fatal since we are waiting infinite for the client to become ready
        this.logger.error('Failed to connect to GRPC client', error);
        this.health.next(false)
      }
    });
  }

  // gRPC method names need to camel-cased
  private normalizeMethodName(methodName: string): string {
    this.logger.debug(`Normalizing method name ${methodName}`);
    return methodName.charAt(0).toLowerCase() + methodName.slice(1);
  }

  // Calls the gRPC method
  public async call(methodName: string, context: Context, message: any): Promise<any> {
    methodName = this.normalizeMethodName(methodName);
    this.logger.debug(`Calling ${methodName} on ${this.protoConfig.service} with:`, message);

    const method = this.client[methodName];
    if (!method) {
      const errorMessage = `RPC method: ${methodName} doesn't exist on GRPC client: ${this.protoConfig.service}`;
      this.logger.error(errorMessage);
      throw Error(errorMessage);
    }

    const meta = context ? this.transformContext(context) : this.grpc.Metadata();
    const now = new Date();
    const deadline = now.setSeconds(now.getSeconds() + this.callTimeout);

    return new Promise((resolve, reject) => {
      method(message, meta, { deadline: deadline }, (error, response) => {
        if (error) {
          this.logger.error(`Call ${method} on ${this.protoConfig.service} failed with error: `, error);
          console.error(error);
          reject(error);
        } else {
          this.logger.debug(`Call ${method} on ${this.protoConfig.service} responded with: `, response);
          resolve(response);
        }
      });
    });
  }

  // Recursive function that emits the channelState
  private monitorGRPCHealth(currentState) {
    this.client.getChannel().watchConnectivityState(currentState, Infinity, () => {
      const newState = this.client.getChannel().getConnectivityState(true);
      this.channelState.next(newState);
      this.monitorGRPCHealth(newState);
    });
  }

  // Transforms context to grpc metadata
  private transformContext(context: Context) {
    const meta = new this.grpc.Metadata();
    meta.add('Authorization', context.token);
    meta.add('request-id', context.requestId);
    return meta;
  }
}
