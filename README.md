# BrainSpark Transformer

Standalone application that filters, transforms, and indexes a stream of events from NSQ into Elasticsearch.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

The only prerequisites for using this repository are [Docker](https://www.docker.com/what-container) & [Node.js](https://nodejs.org/en/).

Installation links:

- [Docker](https://store.docker.com/search?type=edition&offering=community)
- [Node.js](https://nodejs.org/en/download/)

## Configuration

The configuration can be changed by editing config.yml file. This includes NSQ and ElasticSearch instance addresses, schema definition for valid messages etc.

## Running Locally

Make sure you have [Node.js](http://nodejs.org/) installed.

```sh
git clone https://github.com/atoztoa/transformer.git # or clone your own fork
cd transformer
npm start
```

## Building Docker Image

```sh
cd transformer
docker build -t transformer .
```

## Running on Docker

```sh
docker run -d --network host -t transformer
```

Note: Make sure NSQ and ElasticSearch instances are running as per the configuration.

## Running the tests

The unit tests can be run by the command

```sh
npm test
```

Note: Make sure NSQ and ElasticSearch instances are running as per the configuration.

## Highlights

* Extensive app configuration.
* Docker support.
* Production ready.
* Scaleable horizontally as NSQ events are depleted on reading by any instance for the same channel.

## Hurdles Faced

* Overlooked the fact that in NSQ, 'Channels are created on first use by subscribing to the named channel'.
* Handling chained asynchronous HTTP requests, kudos to Promises.

## Things To Do

* If transformer is started after NSQ has run for a while, it will start bombarding ElasticSearch which will reject the messages more than the queue size.
```sh
status: 429,
displayName: 'TooManyRequests',
message: '[es_rejected_execution_exception] rejected execution of org.elasticsearch.transport.TransportService$7@53f0ecd9 on EsThreadPoolExecutor[bulk, queue capacity = 200, org.elasticsearch.common.util.concurrent.EsThreadPoolExecutor@727c4094[Running, pool size = 4, active threads = 4, queued tasks = 200, completed tasks = 2011]]',
```

## Authors

* **Abheesh Suresh Babu**

## Acknowledgments

* Hat's off to Chris.
