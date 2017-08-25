var path = require('path'); 
var fs = require('fs'); 


function ExecutableUnit(params){
    
    let currentContext = (()=>{
        /*
        let response = {
            statusCode: '400',
            body: JSON.stringify({ error: 'you messed up!' }),
            headers: {
                'Content-Type': 'application/json',
            }
        };*/

        var contextData = {headers:{"Content-Type": "application/json"}};
        var callbackFunc;
        return {
            succeed: (successJson) => {
                contextData = successJson;
                if (callbackFunc)
                    callbackFunc(successJson);
            },
            fail: (failJson) => {
                contextData = failJson;
                if (callbackFunc)
                    callbackFunc(failJson);
            },
            steroidsGetContext: () => {
                return contextData;
            },
            setCallback: (cb)=>{
                callbackFunc = cb;
            }
        }
    })();

    function dispatchToLambda(event,context,callback){
        
        let dotIndex = params.lambda.lastIndexOf(".");
        let handlerName = params.lambda.substring(dotIndex + 1);
        let lambdaFileName = params.lambda.substring(0,dotIndex);
        let fileName = lambdaFileName + ".js";

        let exists = fs.existsSync(fileName);
        if (exists) { 
            let lFunction = require("../../" + fileName);
            let callbackFunc = (error,result) => {
                if (!result){
                    if (error)
                        result = error;
                }

                callback(result);
            };
            context.setCallback(callbackFunc);
            let result = lFunction[handlerName](event,context,callbackFunc);
        } else {
            callback ({success: false, message: "Lambda function doesn't exist'"});
        }
    }

    return {
        handle : (req, res,next) => {
            var eventObject = {
                pathParameters: req.params,
                httpMethod: req.method,
                headers: req.headers,
                body: req.body,
                queryStringParameters:req.query
            };

            dispatchToLambda(eventObject,currentContext,(result) => {
                let cObj = currentContext.steroidsGetContext();
                let contentType = undefined;
                if (cObj.headers){
                    if (cObj.statusCode !== undefined)
                        res.writeHead(parseInt(cObj.statusCode), cObj.headers);
                    else
                        res.writeHead(200,cObj.headers);

                    for (let hKey in cObj.headers){
                        let hVal = cObj.headers[hKey] === undefined ? undefined : cObj.headers[hKey].toLowerCase();
                        switch(hKey.toLowerCase()){
                            case "content-type":
                                contentType = hVal;
                                break;
                        }
                    }
                }else {
                    if (cObj.statusCode !== undefined)
                        res.writeHead(parseInt(cObj.statusCode));
                    else
                        res.writeHead(200);
                }
                
                if (!contentType)
                    contentType = "application/json";

                if (contentType === "application/json"){
                    if (typeof result.body === "string")
                        res.write(result.body);
                    else
                        res.write(JSON.stringify(result.body));
                }
                else
                    res.write(result.body);
                    
                res.end();
                next();
            });

        }
    }
}


function MsfCore(){
    let restify = require('restify');

    let routes = {get:{},post:{}};

    function setRoute(method, params, lambda){
        routes[method][params] =  lambda;
    }

    function startRoutingEngine(){
        let server = restify.createServer();
        
        server.use(restify.acceptParser(server.acceptable));
        server.use(restify.jsonp());
        server.use(restify.bodyParser());

        for (let mKey in routes)
        for (let mParam in routes[mKey]){
            let inObject = {
                lambda: routes[mKey][mParam],
                method: mKey
            };

            let eUnit = new ExecutableUnit(inObject);
            let newPath;
            if (mParam.includes("{")){
                let splitData = mParam.split ("/");
                newPath = "";    
                for (let j=0;j<splitData.length;j++){
                    let fItem = splitData[j];
                    if (fItem.includes("{"))
                        fItem = ":" + (fItem.replace("{","").replace("}",""));
                    newPath += ("/" + fItem);
                }
            }else newPath = mParam;

            server[mKey](newPath, eUnit.handle);
        }
        
        server.use(restify.acceptParser(server.acceptable));
        server.use(restify.jsonp());
        server.use(restify.bodyParser({ mapParams: false }));
        server.listen(7777, () => {
            console.log('%s listening at %s', server.name, server.url);
        });
    }


    function loadServerless(){
        let yaml = require('js-yaml');
        let fs   = require('fs');

        try {
            let ymlData = yaml.safeLoad(fs.readFileSync('serverless.yml', 'utf8'));
            
            if (ymlData)
            if (ymlData.functions){
                for(let funcKey in ymlData.functions){
                    let funcObj = ymlData.functions[funcKey];
                    let lambdaPath = funcObj.handler;

                    for (let i=0;i<funcObj.events.length;i++){
                        let eObj  = funcObj.events[i];
                        
                        for (let eventKey in eObj){
                            if (eventKey === "http"){
                                let eValue = eObj[eventKey];
                                setRoute(eValue.method, eValue.path, lambdaPath);
                            }
                        }
                    }
                }
            }

        } catch (e) {
            console.log(e);
        }
    }

    return {
        get: (params, lambda) => {
            setRoute("get", params, lambda);
        },
        post: (params, lambda) => {
            setRoute("post", params, lambda);
        },
        loadServerless: function(){
            loadServerless();
        },
        start: startRoutingEngine
    }
}

process.on('uncaughtException', function (err) {
  console.log(err);
})

module.exports = new MsfCore();