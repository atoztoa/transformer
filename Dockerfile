FROM node:carbon

MAINTAINER Abheesh Suresh Babu "abheeshs@gmail.com"

# Create app directory
RUN mkdir -p /usr/src/app

# Copy app files
COPY package.json /usr/src/app
COPY *.js /usr/src/app
COPY config.yml /usr/src/app

WORKDIR /usr/src/app

RUN npm install

CMD [ "npm", "start" ]
