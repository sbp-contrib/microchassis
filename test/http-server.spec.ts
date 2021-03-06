import 'reflect-metadata';
import 'mocha'

import * as sinonChai from 'sinon-chai';
import * as sinon from 'sinon';
import * as chai from 'chai';
chai.use(sinonChai);

import { SinonSpy } from 'sinon';
import { expect } from 'chai';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import * as httpStatus from 'http-status';
import * as nodeMocks from 'node-mocks-http';

import { HTTP_METHOD } from '../src/service';
import { Config } from '../src/config';
import { Logger } from '../src/logger';
import { HealthManager } from '../src/health';
import { Context } from '../src/context';
import { HttpServer } from '../src/http-server';
const config = new Config();

const mockLogger = {
  info: (_: string) => { },
  audit: (_: string) => { },
  warn(_: string) { },
  error(_: string) { },
  debug(_: string) { }
}

describe('Http server', () => {
  let httpServer: HttpServer;
  let healthManager: HealthManager;
  let healthSpy: SinonSpy;
  let mockExpress: () => Object;

  // Express mock spies
  let expressInstantiated: boolean;
  let getSpy: SinonSpy;
  let postSpy: SinonSpy;
  let deleteSpy: SinonSpy;
  let patchSpy: SinonSpy;
  let listenSpy: SinonSpy;
  let disableSpy: SinonSpy;

  beforeEach(() => {
    healthManager = new HealthManager(<Logger>mockLogger);
    healthSpy = sinon.spy();
    healthManager.registerCheck = healthSpy;

    // Reset
    expressInstantiated = false;
    getSpy = sinon.spy();
    postSpy = sinon.spy();
    deleteSpy = sinon.spy();
    patchSpy = sinon.spy();
    listenSpy = sinon.spy();
    disableSpy = sinon.spy();

    mockExpress = () => {
      expressInstantiated = true;
      return {
        get: getSpy,
        post: postSpy,
        delete: deleteSpy,
        patch: patchSpy,
        listen: listenSpy,
        disable: disableSpy,
        use: () => { }
      }
    };

    httpServer = new HttpServer(mockExpress, <Config>config, <Logger>mockLogger, healthManager);
  });

  describe('Constructor', () => {
    it('should instantiate an express server', () => {
      expect(expressInstantiated).to.equal(true);
    });

    it('should disable the x-powered-by header', () => {
      expect(disableSpy).to.have.been.calledWith('x-powered-by');
    });

    it('should register with the health manager with initial state unhealthy', () => {
      expect(healthSpy).to.have.been.calledOnce;

      const check: BehaviorSubject<boolean> = healthSpy.getCall(0).args[1];
      expect(check).to.be.an.instanceOf(BehaviorSubject);
      expect(check.getValue()).to.equal(false);
    });

    it('should register an health endpoint on the server', () => {
      expect(getSpy).to.have.been.calledOnce;
      const url = getSpy.getCall(0).args[0];
      const handler = getSpy.getCall(0).args[1];

      expect(url).to.equal('/check');

      let responseCode: number = -1;

      const response = {
        status: (statusCode: number) => {
          responseCode = statusCode;

          return {
            send: (_: string) => { }
          }
        }
      };

      handler({}, response);

      expect(responseCode).to.equal(503);

      healthManager.healthy = true;
      handler({}, response);

      expect(responseCode).to.equal(200);
    });
  });

  describe('registerService', () => {
    it('Default method should be get', () => {
      const service = {
        url: '/foobar',
        method: HTTP_METHOD.GET,
        handler: () => {
          return new Promise(() => { });
        }
      };

      httpServer.registerService(() => service);

      // Twice, health and this new service
      expect(getSpy).to.have.been.calledTwice;
    });

    it('Should normalize the url to start with /', () => {
      const service = {
        url: 'foobar',
        method: HTTP_METHOD.GET,
        handler: () => {
          return new Promise(() => { });
        }
      };

      httpServer.registerService(() => service);

      // Twice, health and this new service
      expect(getSpy).to.have.been.calledTwice;
      const url = getSpy.getCall(1).args[0];
      expect(url).to.equal('/foobar');
    });

    it('Should work with deeper paths then one', () => {
      const service = {
        url: '/v1/bar/foo/bar',
        method: HTTP_METHOD.GET,
        handler: () => {
          return new Promise(() => { });
        }
      };

      httpServer.registerService(() => service);

      // Twice, health and this new service
      expect(getSpy).to.have.been.calledTwice;
      const url = getSpy.getCall(1).args[0];
      expect(url).to.equal('/v1/bar/foo/bar');
    });

    it('Should prefix the url with the http root if one is given', () => {
      (<any>config)['httpRoot'] = 'testing';

      const service = {
        url: 'foobar',
        method: HTTP_METHOD.GET,
        handler: () => {
          return new Promise(() => { });
        }
      };

      httpServer.registerService(() => service);

      // Twice, health and this new service
      expect(getSpy).to.have.been.calledTwice;
      const url = getSpy.getCall(1).args[0];
      expect(url).to.equal('/testing/foobar');
    });

    it('Should normalize the httpRoot properly', () => {
      (<any>config)['httpRoot'] = 'testing/';

      const service = {
        url: 'foobar',
        method: HTTP_METHOD.GET,
        handler: () => {
          return new Promise(() => { });
        }
      };

      httpServer.registerService(() => service);

      const url = getSpy.getCall(1).args[0];
      expect(url).to.equal('/testing/foobar');
    });

    it('should not throw an error when the same url with a different method is being registered', () => {
      const serviceOne = {
        method: HTTP_METHOD.GET,
        url: 'foobar',
        handler: () => { return new Promise(() => { }) }
      };

      const serviceTwo = {
        method: HTTP_METHOD.POST,
        url: 'foobar',
        handler: () => { return new Promise(() => { }) }
      };

      function register() {
        httpServer.registerService(() => serviceOne);
        httpServer.registerService(() => serviceTwo);
      }

      expect(register).to.not.throw();
    });


    it('should throw an error when the same method on the same url is being registered', () => {
      const serviceOne = {
        method: HTTP_METHOD.POST,
        url: 'foobar',
        handler: () => { return new Promise(() => { }) }
      };

      const serviceTwo = {
        method: HTTP_METHOD.POST,
        url: 'foobar',
        handler: () => { return new Promise(() => { }) }
      };

      function register() {
        httpServer.registerService(() => serviceOne);
        httpServer.registerService(() => serviceTwo);
      }

      expect(register).to.throw();
    });
  });

  describe('start', () => {
    it('It should call listen on express when starting server with the correct port', () => {
      httpServer.start();
      expect(listenSpy).to.have.been.calledOnce;
      expect(listenSpy.getCall(0).args[0]).to.equal(config.get('httpPort'));
    });

    it('It should send out an health update when the server is started', () => {
      httpServer.start();

      expect(httpServer.health.getValue()).to.equal(false);

      // Given callback
      listenSpy.getCall(0).args[1]();

      expect(httpServer.health.getValue()).to.equal(true);
    });
  });

  describe('Request handler', () => {
    it('Should build up the context correctly', () => {
      const handlerSpy = sinon.stub().returns(new Promise(() => { }));
      const service = {
        url: '/foobar',
        method: HTTP_METHOD.GET,
        handler: handlerSpy
      };

      httpServer.registerService(() => service);

      const handler = getSpy.getCall(1).args[1];
      const expectedToken = 'foobar';
      const expectedRequestId = 'requestid';

      const request = nodeMocks.createRequest({
        method: HTTP_METHOD.GET,
        url: '/foobar',
        headers: {
          'Authorization': `Token ${expectedToken}`,
          'X-Request-ID': expectedRequestId
        }
      });

      handler(request, {});

      const args = handlerSpy.getCall(0).args;
      const context: Context = args[0];

      expect(context.token).to.equal(expectedToken);
      expect(context.requestId).to.equal(expectedRequestId);
    });

    it('Should reject unauthenticated requests with 403', () => {
      const handlerSpy = sinon.stub().returns(new Promise(() => { }));
      const service = {
        url: '/foobar',
        method: HTTP_METHOD.GET,
        handler: handlerSpy
      };

      httpServer.registerService(() => service);

      const handler = getSpy.getCall(1).args[1];
      const request = nodeMocks.createRequest({
        headers: {}
      });

      let responseText: string = '';
      let statusCode: number = -1;

      const response = {
        status: (status: number) => {
          statusCode = status;
          return {
            send: (sendResponse: string) => {
              responseText = sendResponse;
            }
          }
        }
      }

      handler(request, response);

      expect(statusCode).to.equal(403);
      expect(responseText).to.equal('Unauthenticated');
    });

    it('Should map query params correctly', () => {
      const handlerSpy = sinon.stub().returns(new Promise(() => { }));

      const service = {
        url: '/foobar',
        queryMapping: {
          'foo': 'somekey',
          'bar': 'some.other.key'
        },
        method: HTTP_METHOD.GET,
        handler: handlerSpy,
        unauthenticated: true
      };

      httpServer.registerService(() => service);
      const handler = getSpy.getCall(1).args[1];
      const request = nodeMocks.createRequest({
        method: HTTP_METHOD.GET,
        url: '/foobar',
        query: {
          'foo': 'hello',
          'bar': 'world'
        },
        body: {}
      });

      handler(request, {});

      const body = handlerSpy.getCall(0).args[1];
      expect(body.somekey).to.equal('hello');
      expect(body.some.other.key).to.equal('world');
    });

    it('Should map url params correctly', () => {
      const handlerSpy = sinon.stub().returns(new Promise(() => { }));

      const service = {
        url: '/:id/:id2/foobar',
        urlMapping: {
          id1: 'foo.bar',
          id2: 'hello'
        },
        method: HTTP_METHOD.GET,
        handler: handlerSpy,
        unauthenticated: true
      };

      httpServer.registerService(() => service);

      const handler = getSpy.getCall(1).args[1];
      const request = nodeMocks.createRequest({
        method: HTTP_METHOD.GET,
        url: '/1/2/foobar',
        params: {
          id1: '1',
          id2: '2'
        }
      });

      handler(request, {});

      const body = handlerSpy.getCall(0).args[1];
      expect(body.foo.bar).to.equal('1');
      expect(body.hello).to.equal('2')
    });

    it('Default response status code for success should be 200', (done) => {
      const responseBody = { foo: 'bar' };
      const handlerSpy = sinon.stub().returns(new Promise((resolve, _) => {
        resolve({
          content: responseBody
        });
      }));

      const service = {
        url: '/foobar',
        method: HTTP_METHOD.GET,
        handler: handlerSpy,
        unauthenticated: true
      };

      httpServer.registerService(() => service);

      const handler = getSpy.getCall(1).args[1];
      const request = nodeMocks.createRequest({
        method: HTTP_METHOD.GET,
        url: '/foobar'
      });

      const response = {
        status: (status: number) => {
          expect(status).to.equal(200);

          return {
            send: (sendResponse: string) => {
              expect(sendResponse).to.equal(responseBody);
              done();
            }
          }
        }
      }

      handler(request, response);
    });

    it('It should return success and content is callback called without error', (done: any) => {
      const responseBody = { foo: 'bar' };
      const handlerSpy = sinon.stub().returns(new Promise((resolve, _) => {
        resolve({
          status: httpStatus.CREATED,
          content: responseBody
        });
      }));

      const service = {
        url: '/foobar',
        method: HTTP_METHOD.GET,
        handler: handlerSpy,
        unauthenticated: true
      };

      httpServer.registerService(() => service);

      const handler = getSpy.getCall(1).args[1];
      const request = nodeMocks.createRequest({
        method: HTTP_METHOD.GET,
        url: '/foobar'
      });

      const response = {
        status: (status: number) => {
          expect(status).to.equal(201);

          return {
            send: (sendResponse: string) => {
              expect(sendResponse).to.equal(responseBody);
              done();
            }
          }
        }
      }

      handler(request, response);
    });
  });
});
