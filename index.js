'use strict';

const fs = require('fs');
const child_process= require('child_process');
const normalizer = require('./normalizer');
const os = require('os');
// const aws = require('aws-sdk');

exports.handler=(event, context, callback)=>{
    const bucketSource = event.bucketSource;
    const bucketDestination = event.bucketDestination;
    console.log(`Processing audio(s) from bucket: ${bucketSource}`);
    alterMp3(bucketSource, bucketDestination);
};

function execAwsCli(cmd) {
    return new Promise((resolve, reject)=>{
        console.log('executing:', cmd);
        child_process.exec(cmd, (error, stdout, stderr) => {
            if(error) reject(error);
            // console.log('stdout is: '+stdout);
            //Completed 256.0 KiB/5.8 MiB (410.0 KiB/s) with 2 file(s) remaining
            resolve(stdout);
        });
    });
}
function getMp3FromS3(bucket) {
    const cmd = [`./cli/aws s3 cp s3://${bucket}/  /tmp --recursive`];
    return execAwsCli(cmd).then((response)=>{
        return normalizer.processAudios('/tmp');
    }).catch((error)=>{
        throw `Error while copying bucket ${bucket}.`;
    });
}
function sendBackToS3(bucketDest) {
    const cmd = [`./cli/aws s3 cp /tmp s3://${bucketDest}/ --recursive`];
    return execAwsCli(cmd).catch((err)=>{
        throw err +" could not upload to s3.";
    });
}
function alterMp3(bucketS, bucketDest) {
    getMp3FromS3(bucketS).then(function() {
        return sendBackToS3(bucketDest);
    }).then(function(success) {
        console.log("All done!");
    }).catch(function(err) {
        console.log("It failed!", err);
    });
}
