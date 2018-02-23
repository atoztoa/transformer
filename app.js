/**
 * Transformer module filters, transforms, and indexes events from NSQ into Elasticsearch.
 *
 * @module transformer
 */

const nsq = require('nsqjs');
const YAML = require('yamljs');
const request = require('request');
const { validate } = require('jsonschema');
const uuid = require('uuid');
const elasticsearch = require('elasticsearch');

// Initialize app configuration, we will populate it below
let config = null;

/**
 * Load app configuration from config file, fallback to defaults.
 */
function loadConfiguration() {
  try {
    config = YAML.load('config.yml');
  } catch (err) {
    config = null;
  }

  // Load default configuration
  if (config == null) {
    config = {
      server: {
        nsq: {
          host: 'localhost',
          port: 4150,
        },
        nsqadmin: {
          host: 'localhost',
          port: 4151,
        },
        elastic: {
          host: 'localhost',
          port: 9200,
        },
        brainspark: {
          host: 'localhost',
          port: 8080,
        },
      },
      http: {
        timeout: 10000,
      },
      nsq: {
        topic: 'events',
        channel: 'transformer',
      },
      msg: {
        keycount: 7,
        schema: {
          id: '/Message',
          type: 'object',
          properties: {
            id: {
              type: 'string',
              required: true,
            },
            attempt_id: {
              type: 'string',
              required: true,
            },
            progress: {
              type: 'number',
              required: true,
            },
            score: {
              type: 'number',
              required: true,
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              required: true,
            },
            type: {
              type: 'string',
              required: true,
            },
            user_id: {
              type: 'string',
              required: true,
            },
          },
        },
      },
      brainspark: {
        method: {
          attempt: 'Participation.GetAttempt',
          course: 'Content.GetCourse',
          trainee: 'Account.GetUser',
          user: 'Account.GetUser',
        },
      },
      elastic: {
        type: 'event',
        indexprefix: 'events-',
      },
    };
  }
}

// Load app configuration
loadConfiguration();

// Create a connection to Elastic
const elasticClient = new elasticsearch.Client({
  host: `${config.server.elastic.host}:${config.server.elastic.port}`,
});

/**
 * Index event to Elastic instance.
 *
 * @param {Object} msg The event to index.
 */
function indexToElastic(msg) {
  elasticClient.create({
    index: `${config.elastic.indexprefix}${msg.timestamp.split('T')[0]}`,
    type: config.elastic.type,
    id: uuid.v4(),
    body: msg,
  }, (error) => {
    if (error) {
      console.log(error);
    }
  });
}


/**
 * Validate incoming message and determine if this needs to be processed.
 *
 * @param {Object} msg Incoming message to check.
 *
 * @return {Boolean}
 */
function isIndexableMessage(msg) {
  // Object?
  if (typeof msg !== 'object' || msg === null) {
    return false;
  }

  // Extra keys?
  if (Object.keys(msg).length > config.msg.keycount) {
    return false;
  }

  // Schema?
  if (!validate(msg, config.msg.schema).valid) {
    return false;
  }

  // Filter out events with type `FOO`
  if (msg.type === 'FOO') {
    return false;
  }

  return true;
}


/**
 * Get details from Brainspark API.
 * A Promise is returned, to be filled by the aync call.
 *
 * @param {string} type Type of API to call.
 * @param {string} id The id to lookup details for.
 *
 * @return {Promise}
 */
function getDetails(type, id) {
  if (!id) {
    return new Promise((resolve) => {
      resolve(null);
    });
  }

  const requestOptions = {
    url: `http://${config.server.brainspark.host}:${config.server.brainspark.port}/`,
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  };

  // Set timeout
  requestOptions.timeout = config.http.timeout;

  // Create json request
  const data = {
    jsonrpc: '2.0',
    method: config.brainspark.method[type],
    id: uuid.v4(),
    params: { id },
  };

  requestOptions.json = data;

  // Let's return a Promise
  return new Promise((resolve, reject) => {
    request(requestOptions, (error, response, body) => {
      if (error) {
        reject(error);
      } else if (response && (response.statusCode < 200 || response.statusCode > 299)) {
        reject(response.statusCode);
      } else if (!body || !body.result || !body.result.data) {
        resolve(null);
      } else {
        resolve(body.result.data);
      }
    });
  });
}


/**
 * Populate details in the event message by pulling from BrainSpark API and index to Elastic.
 * Possible types are attempt, course, trainee, user.
 *
 * @param {Object} msg The incoming message.
 */
function hydrateAndIndex(msg) {
  // Details for each type is retreived async and is done using Promise chains.
  // Let's do this
  const fullMessage = msg;

  // Resolve 'attempt'
  getDetails('attempt', fullMessage.attempt_id).then((result) => {
    if (result) {
      fullMessage.attempt = result;
      fullMessage.course_id = fullMessage.attempt.course_id;
      fullMessage.trainee_id = fullMessage.attempt.trainee_id;
    }
  }, (err) => {
    console.log(err);
  }).then(() => {
    // Resolve 'course'
    getDetails('course', fullMessage.course_id).then((result) => {
      if (result) {
        fullMessage.course = result;
      }
    }, (err) => {
      console.log(err);
    }).then(() => {
      // Resolve 'trainee'
      getDetails('trainee', fullMessage.trainee_id).then((result) => {
        if (result) {
          fullMessage.trainee = result;
        }
      }, (err) => {
        console.log(err);
      }).then(() => {
        // Resolve 'user'
        getDetails('user', fullMessage.user_id).then((result) => {
          if (result) {
            fullMessage.user = result;
          }
        }, (err) => {
          console.log(err);
        }).then(() => {
          // Let send the event to Elastic
          indexToElastic(fullMessage);
        });
      });
    });
  });
}


/**
 * Validate incoming message and process if required.
 *
 * @param {Object} msg The incoming message.
 */
function transformMessage(msg) {
  if (isIndexableMessage(msg)) {
    hydrateAndIndex(msg);
  }
}


/**
 * Start reading from NSQ instance.
 */
function startReader() {
  const reader = new nsq.Reader(config.nsq.topic, config.nsq.channel, {
    nsqdTCPAddresses: [`${config.server.nsq.host}:${config.server.nsq.port}`],
  });

  reader.connect();

  reader.on('message', (msg) => {
    transformMessage(JSON.parse(msg.body.toString()));
    msg.finish();
  });

  reader.on('error', (msg) => {
    console.log(msg);
  });
}


// ----------------------------------- MAIN -----------------------------------

// Let's start receiving NSQ events
if (process.env.NODE_ENV !== 'test') {
  startReader();
}

/*

## Requirements
- your code should include a `README.md` file in the root with instructions for building, running, and testing. It can also include notes on your throught process and any issues you may have run into.

## Evaluation
We will evaluate your submission using the following criteria
- Is your application well organized?
- Is your code documented?
- Is your code efficient & performant?

## Submission
Please upload this repository to Github and submit to @jgiless when complete. Also, we would love your feedback, so feel free to share your thoughts on the exercise!

status: 429,
  displayName: 'TooManyRequests',
    message: '[es_rejected_execution_exception] rejected execution of org.elasticsearch.transport.TransportService$7@53f0ecd9 on EsThreadPoolExecutor[bulk, queue capacity = 200, org.elasticsearch.common.util.concurrent.EsThreadPoolExecutor@727c4094[Running, pool size = 4, active threads = 4, queued tasks = 200, completed tasks = 2011]]',


*/


//
//
// --------------------------------- THIS SECTION SHOULD BE IN A SEPARATE TEST FILE --------- LAZY -----
//
//

if (process.env.NODE_ENV === 'test') {
  const test = require('tape');

  test('Configuration test', (t) => {
    t.equal(typeof loadConfiguration, 'function');

    loadConfiguration();

    t.ok(config);
    t.ok(config.server.nsq);
    t.ok(!config.server.blah);

    t.end();
  });

  test('Message validation test', (t) => {
    t.equal(typeof isIndexableMessage, 'function');

    const data = {
      id: '5c92de28-14f0-449e-821b-e61e871179c2',
      attempt_id: 'e70a6ecf-f308-4306-831d-bb41c851061d',
      progress: 0.63414633,
      score: 0.96158886,
      timestamp: '2018-01-16T14:09:51.655185082-07:00',
      type: 'PROGRESS',
      user_id: '471de972-520c-4f44-bd6d-34cc98dd5e6e',
    };

    let result = isIndexableMessage(data);
    t.ok(result);

    data.bad_key = 'Bad';
    result = isIndexableMessage(data);
    t.ok(!result);
    delete data.bad_key;

    data.timestamp = 'Bad';
    result = isIndexableMessage(data);
    t.ok(!result);
    data.timestamp = '2018-01-16T14:09:51.655185082-07:00';

    delete data.type;
    result = isIndexableMessage(data);
    t.ok(!result);

    data.type = 'FOO';
    result = isIndexableMessage(data);
    t.ok(!result);

    t.end();
  });

  test('Get Details from Brainspark server test', (t) => {
    t.equal(typeof getDetails, 'function');

    getDetails('user', '0af39638-abc6-444c-b74d-420f7592b5c5').then((result) => {
      t.ok(result);
      t.ok(result.account_id);
    }, (err) => {
      t.ok(!err);
    });

    t.end();
  });
}
