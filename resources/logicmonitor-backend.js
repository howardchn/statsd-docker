/**
 * To support to send statsd metrics to logicmonitor.
 * Created by edward.gao on 16/06/2017.
 */

var http = require('http');
var https = require('https');
var util = require('util');
var os = require('os');

var timeoutInSeconds = 15;
var self;

function LogicMonitorBackend(startupTime, config, events) {
    self = this;
    var collectorConfig = config.logicmonitor;
    if (collectorConfig !== undefined) {
        self.company = collectorConfig.company;
        self.statsdToken = collectorConfig.statsdToken;
        self.statsdAccessId = collectorConfig.statsdAccessId;
        self.namespace = sanitizeName(collectorConfig.namespace || getDefaultNamespace());
        self.protocol = collectorConfig.protocol || 'https';
        self.port = collectorConfig.port || (self.protocol == 'https' ? 443 : 80);
        timeoutInSeconds = collectorConfig.timeout || timeoutInSeconds;
        // check all confs we got
        if (!self.company || !self.statsdAccessId || !self.statsdToken) {
            util.log('Must set company/statsdAccessId/statsdToken in config', 'ERROR');
            return null;
        }
        // reject unauthorized ssl certs ?
        if (collectorConfig.rejectUnauthorized !== undefined) {
            // only when the option is false, we don't reject ssl related certs
            self.rejectUnauthorized = !(collectorConfig.rejectUnauthorized.toString().toLowerCase() === 'false');
        }
        else {
            self.rejectUnauthorized = true;
        }

    }
    else {
        util.log('No logicmonitor in your config set, please check the config');
        return null;
    }
    self.config = config; // keep this config here.

    util.log('Init logicmonitor statsd backend, company=' + self.company +' namespace=' + self.namespace + ' protocol=' + self.protocol +' port=' + self.port);

    events.on('flush', function (timestamp, metrics) {
        try {
            self.flush(timestamp, metrics);
        } catch (e) {
            util.log(e, 'ERROR');
        }
    })
    return this;
}


function getDefaultNamespace() {
    // get the current host's hostname
    return os.hostname();
}

LogicMonitorBackend.prototype.flush = function (timestamp, metrics) {
    var self = this;
    var post_data = JSON.stringify(composeData(timestamp, metrics));
    util.log('flush called' + timestamp + 'metrics \n' + post_data);
    // An object of options to indicate where to post to
    var post_options = {
        hostname: self.company + '.logicmonitor.com',
        port : self.port,
        path : appendCommonParameters('/statsd/api/reportData'),
        method : 'POST',
        timeout : timeoutInSeconds * 1000,
        rejectUnauthorized : self.rejectUnauthorized,
        headers : {
            'Content-Type': 'text/json;charset="utf-8"',
            'Content-Length': Buffer.byteLength(post_data),
            'Connection': 'keep-alive',
            'X-LogicMonitor-Backend-Version' : 'LogicMonitor Backend/1.0'
        }
    };

    // Set up the request
    var protocol = self.protocol === 'https' ? https : http;

    var post_req = protocol.request(post_options, function (response) {
        if (response.statusCode != 200) {
            util.log('No-200 received - ' + response, 'WARN');
        }
        response.setEncoding('UTF-8');
        response.on('data', function (chunk) {
            util.log('receive response ' + chunk)
        });
        response.on('end', function () {
        });
    });

    // when timeout happened, abot the request
    post_req.setTimeout(timeoutInSeconds * 1000, function () {
        util.log('Timeout happened for request', 'WARN');
        post_req.abort();
    });

    // set the error handler
    post_req.on('error', function (err) {
        util.log('Fail to send request ' + err, 'WARN');
        post_req.abort();
    });

    // post the data
    post_req.write(post_data);
    post_req.end();
}

/**
 * compose the backend data here.
 *
 * @param timestamp
 * @param metrics
 */
function composeData(timestamp, metrics) {

    var setsObject = {};

    for (var key in metrics.sets) {
        setsObject[key] = metrics.sets[key].size();
    }

    var timerDataObject = {};
    for (var key in metrics.timer_data) {
        var currentTimerData = {};
        currentTimerData.count = metrics.timer_data[key].count;
        currentTimerData.upper = metrics.timer_data[key].upper;
        currentTimerData.lower = metrics.timer_data[key].lower;
        currentTimerData.mean = metrics.timer_data[key].mean;
        currentTimerData['upper_' + self.config.pctThreshold] = metrics.timer_data[key]['upper_' + self.config.pctThreshold];
        timerDataObject[key] = currentTimerData;
    }

    var dataObject = {
        'flushInterval' : self.config.flushInterval / 1000, // in seconds
        'timestamp' : timestamp * 1000, // in mill seconds
        'counters_rates' : metrics.counter_rates,
        'gauges' : metrics.gauges,
        'sets_sizes' : setsObject,
        'timer_data' : timerDataObject,
        'pctThreshold' : self.config.pctThreshold
    }

    var version = 1; // version number , current set it as 1
    var postData = {
        'namespace': self.namespace,
        'version' : version,
        'data' : dataObject
    }
    return postData;
}

/**
 * append other common parameters (namespace, company, statsdToken, statsdAccessId)to the url.
 *
 * @param url
 * @returns {string}
 */
function appendCommonParameters(url) {
    return url + '?namespace=' + encodeURIComponent(self.namespace) + '&company=' + self.company + '&statsdToken=' + encodeURIComponent(self.statsdToken) + '&statsdAccessId='+ encodeURIComponent(self.statsdAccessId);
}

/**
 * return a string only with . and A-Z a-z 0-9 _
 * @param str
 */
function sanitizeName(str) {
    return str.replace(/[^A-Za-z0-9._-]/g, '');
}

exports.init = function (startupTime, config, events, logger) {
    var instance = new LogicMonitorBackend(startupTime, config, events, logger);
    return !!instance;
};
