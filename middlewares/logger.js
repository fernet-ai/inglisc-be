const morgan = require('morgan');

morgan.token('client-ip', (req) => req.ip || req.connection.remoteAddress);

const loggerMiddleware = (req, res, next) => {
  const requestBody = JSON.stringify(req.body);
  const logRequestMessage = `\nREQUEST  | IP:${req.ip} - ${req.method} ${req.originalUrl} - request body: ${requestBody}`;
  console.log(logRequestMessage);

  const originalJson = res.json;

  res.json = function (data) {
    const logResponseMessage = `RESPONSE | IP:${req.ip} - ${req.method} ${req.originalUrl} - response: ${JSON.stringify(data)}\n`;
    console.log(logResponseMessage);
    
    originalJson.call(this, data);
  };

  req.startTime = Date.now();
  next();
};

module.exports = loggerMiddleware;
