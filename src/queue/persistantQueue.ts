import { EventEmitter } from 'events';
const sqlite3 = require('sqlite3').verbose();

let table = 'queue';
let table_count = 'queue_count';

function PersistentQueue(this: any, filename: string, batchSize: number) {
    EventEmitter.call(this);

    if (filename === undefined)
        throw new Error('No filename parameter provided');

    this.debug = false;
    this.empty = undefined;
    this.dbPath = this.dbPath = (filename === '') ? ':memory:' : filename;
    this.batchSize = (batchSize === undefined) ? 10 : batchSize;

    if (typeof this.batchSize !== 'number' || this.batchSize < 1)
        throw new Error('Invalid batchSize parameter.  Must be a NUMBER > 0');

    this.queue = [];
    this.length = null;
    this.db = null;
    this.opened = false;
    this.run = false;

    this.on('start', () => {
        if (this.db === null)
            throw new Error('Open queue database before starting queue');

        if (this.run === false) {
            this.run = true;
            this.emit('trigger_next');
        }
    });

    this.on('stop', () => {
        this.run = false;
    });

    this.on('trigger_next', () => {
        if (this.debug) console.log('trigger_next');
        if (!this.run || this.empty) {
            if (this.debug) console.log('run=' + this.run + ' and empty=' + this.empty);
            if (this.debug) console.log('not started or empty queue');
            return;
        }

        const trigger = () => {
            this.emit('next', this.queue[0]);
        };

        if (this.queue.length === 0 && this.length !== 0) {

            hydrateQueue(this, this.batchSize)
                .then(() => {

                    setImmediate(trigger);
                })
                .catch(err => {
                    console.error(err);
                    process.exit(1);
                });
        }
        else if (this.queue.length) {
            setImmediate(trigger);
        }
        else {
            this.emit('empty');
        }
    });

    this.on('empty', () => {
        this.empty = true;
        this.db.exec("VACUUM;")
    });

    this.on('add', (job: any) => {
        if (this.empty) {
            this.empty = false;
            if (this.debug) console.log('No longer empty');
            if (this.run)
                this.emit('trigger_next');
        }
    });

    this.on('open', (db: any) => {
        this.opened = true;
    });

    this.on('close', () => {
        this.opened = false;
        this.db = null;
        this.empty = undefined;
        this.run = false;
        this.queue = [];
    });
}

PersistentQueue.prototype = Object.create(EventEmitter.prototype);

PersistentQueue.prototype.open = function () {
    return new Promise<void>((resolve, reject) => {
        this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err: any) => {
            if (err !== null)
                reject(err);
            resolve();
        });
    })
        .then(() => {
            /***************====================
             *  Puts the execution mode into serialized. This means that at most one statement object can execute a query
            at a time. Other statements wait in a queue until the previous statements are executed.
            If you call it without a function parameter, the execution mode setting is sticky and won't change until
            the next call to Database#parallelize.
            https://github.com/mapbox/node-sqlite3/wiki/Control-Flow#databaseserializecallback
             ====================**************/
            this.db.serialize();
            //*** */ Create tables if they doesnt exist //*** */
            return new Promise<void>((resolve, reject) => {
                let query = ` 
             CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY ASC AUTOINCREMENT, job TEXT) ; 
             
             CREATE TABLE IF NOT EXISTS ${table_count} (counter BIGINT) ; 
             
             INSERT INTO ${table_count} SELECT 0 as counter WHERE NOT EXISTS(SELECT * FROM ${table_count}) ; 
             
             UPDATE ${table_count} SET counter = (SELECT count(*) FROM ${table}) ; 
             
             CREATE TRIGGER IF NOT EXISTS queue_insert 
             AFTER INSERT 
             ON ${table} 
             BEGIN 
             UPDATE ${table_count} SET counter = counter + 1 ; 
             END; 
             
             CREATE TRIGGER IF NOT EXISTS queue_delete 
             AFTER DELETE 
             ON ${table} 
             BEGIN 
             UPDATE ${table_count} SET counter = counter - 1 ; 
             END; 
             ` ;

                this.db.exec(query, (err: any) => {
                    if (err !== null)
                        reject(err);

                    resolve();
                });
            });
        })
        .then(() => countQueue(this))
        .then(() => {
            //*** */ Load batchSize number of jobs from queue (if there are any) //*** */
            return hydrateQueue(this, this.batchSize)
                .then(jobs => {
                    //If no msg left, set empty to true
                    this.empty = (this.queue.length === 0);

                    this.emit('open', this.db);
                    return Promise.resolve(jobs);
                });
        });
};

PersistentQueue.prototype.close = function () {
    return new Promise<void>((resolve, reject) => {
        this.db.close((err: any) => {
            if (err)
                reject(err);
            this.emit('close');
            resolve();
        });
    });
};

//*** */ Get the total number of jobs in the queue //*** */

PersistentQueue.prototype.getLength = function () {
    return this.length;
};

PersistentQueue.prototype.start = function () {
    this.emit('start');
};

PersistentQueue.prototype.stop = function () {
    this.emit('stop');
};

PersistentQueue.prototype.done = function (id: any) {
    if (this.debug) console.log('Calling done!');
    removeJob(this, id)
        .then(() => {
            if (this.debug) console.log('Job deleted from db');
            this.length--;
            this.emit('trigger_next');
        })
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
};

PersistentQueue.prototype.abort = function () {

    if (this.debug) console.log('Calling abort!');
    this.stop();
};

PersistentQueue.prototype.add = function (job: any) {

    return new Promise((resolve, reject) => {
        this.db.run('INSERT INTO ' + table + ' (job) VALUES (?)', JSON.stringify(job), (err: any) => {
            if (err)
                reject(err);
            this.length++;

            this.emit('add', { id: this.lastID, job: job });
            resolve(this.id);
        });
    });
};

//*** */ Debvuging is off by default //*** */
PersistentQueue.prototype.setDebug = function (debug: any) {
    this.debug = debug;
    return this;
};

PersistentQueue.prototype.isEmpty = function () {
    if (this.empty === undefined)
        throw new Error('Call open() method before calling isEmpty()');
    return this.empty;
};

//*** */ has the queue started to handle jobs? is it working? //*** */

PersistentQueue.prototype.isStarted = function () {
    return this.run;
};
//*** */Is the queue's SQLite DB open?? //*** */

PersistentQueue.prototype.isOpen = function () {
    return this.opened;
};
//*** */ Get a reference to sqlite3 Database instance //*** */

PersistentQueue.prototype.getSqlite3 = function () {
    if (this.db === null)
        throw new Error('Call open() method before calling getSqlite3()');
    return this.db;
};

//*** */ Function that returns true if there is a job with 'id' still in queue, otherwise false //*** */

PersistentQueue.prototype.has = function (id: any) {
    //*** */ First search the in-memory queue  //*** */
    return new Promise((reject, resolve) => {
        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].id === id)
                resolve(true);
        }
        //*** */ Now check the on-disk queue //*** */
        this.db.get('SELECT id FROM ' + table + ' where id = ?', id, (err: any, row: any) => {
            if (err !== null)
                reject(err);

            //*** */ Return true if there is a record, otherwise return false //*** */    
            resolve(row !== undefined);
        });
    });
};

//*** */ This function returns an array of job id numbers matching the given job data in order of execution //*** */

PersistentQueue.prototype.getJobIds = function (job: any) {
    return searchQueue(this, job);
};

PersistentQueue.prototype.getFirstJobId = function (job: any) {

    return new Promise((resolve, reject) => {
        //*** */ search in-memory queue first //**** */
        let jobstr = JSON.stringify(job);
        let i = this.queue.findIndex((j: { job: any; }) => {
            return (JSON.stringify(j.job) === jobstr);
        });
        if (i !== -1) {
            resolve(this.queue[i].id);
            return;
        }
        //*** */ Otherwise search the rest of db queue //*** */
        searchQueue(this, job)
            .then(data => {
                if (data === []) {
                    resolve(null);
                    return;
                }
                resolve(data[0]);
            });
    });
};

//*** */ This function Deletes a job from the queue (if it exists) //*** */
PersistentQueue.prototype.delete = function (id: any) {

    return new Promise((resolve, reject) => {
        removeJob(this, id)
            .then(() => {
                if (this.debug) console.log('Job deleted from db');
                this.emit('delete', { id: id });

                //*** */ decreases/counts down the job length //*** */
                this.length--;
                resolve(id);
            })
            .catch(reject);
    });
};

function countQueue(q: { debug: any; db: { get: (arg0: string, arg1: (err: any, row: any) => void) => void; }; length: any; }) {
    if (q.debug) console.log('CountQueue');
    return new Promise((resolve, reject) => {
        if (q.db === null)
            reject('Open queue database before counting jobs');

        q.db.get('SELECT counter FROM ' + table_count + ' LIMIT 1', (err: any, row: { counter: any; }) => {
            if (err !== null)
                reject(err);
            q.length = row.counter;
            resolve(this.length);
        });
    });
}

function searchQueue(q: { debug: any; db: { all: (arg0: string, arg1: string, arg2: (err: any, jobs: any) => void) => void; }; }, job: any) {

    if (q.debug) console.log('SearchQueue');
    return new Promise((resolve, reject) => {
        if (q.db === null)
            reject('Open queue database before starting queue');

        q.db.all(`SELECT id FROM ${table} where job = ? ORDER BY id ASC`, JSON.stringify(job), (err: any, jobs: any) => {
            if (err !== null)
                reject(err);

            jobs = jobs.map((j: { id: any; }) => j.id);

            if (q.debug) {
                for (let i = 0; i < jobs.length; i++)
                    if (q.debug) console.log(JSON.stringify(jobs[i]));

            }
            resolve(jobs);
        });
    });
}

//*** */ This function will get the 'size' (number of records into queue array) from the DB //*** */

function hydrateQueue(q: { debug: any; db: { all: (arg0: string, arg1: (err: any, jobs: any) => void) => void; }; batchSize: string; queue: any; }, size: any) {
    if (q.debug) console.log('HydrateQueue');
    return new Promise((resolve, reject) => {
        if (q.db === null)
            reject('Open queue database before starting queue');

        q.db.all('SELECT * FROM ' + table + ' ORDER BY id ASC LIMIT ' + q.batchSize, (err: any, jobs: any) => {
            if (err !== null)
                reject(err);

            if (q.debug) {
                for (let i = 0; i < jobs.length; i++)
                    if (q.debug) console.log(JSON.stringify(jobs[i]));

            }

            //*** */ this updates the queue array and converts a stored string back to object //*** */
            q.queue = jobs.map((job: { id: any; job: string; }) => {
                try {
                    return { id: job.id, job: JSON.parse(job.job) };
                }
                catch (err) {
                    reject(err);
                }
            });

            resolve(jobs);
        });
    });
}

//*** */ This function removes the current job from the database and in-memory array//*** */
function removeJob(q: { queue: { id: any; }[]; db: { run: (arg0: string, arg1: any, arg2: (err: any) => void) => void; }; debug: any; length: string; }, id: any) {
    if (id === undefined) {
        id = q.queue.shift().id;
    }
    else {
        //*** */ Search queue for id and remove if exists//*** */
        for (let i = 0; i < q.queue.length; i++) {
            if (q.queue[i].id === id) {
                q.queue.splice(i, 1);
                break;
            }
        }
    }

    return new Promise((resolve, reject) => {
        if (q.db === null)
            reject('Open queue database before starting queue');

        if (q.debug) console.log('About to delete');
        if (q.debug) console.log('Removing job: ' + id);
        if (q.debug) console.log('From table: ' + table);
        if (q.debug) console.log('With queue length: ' + q.length);
        q.db.run('DELETE FROM ' + table + ' WHERE id = ?', id, function (err: any) {
            if (err !== null)
                reject(err);

            if (this.changes) //*** */ Number of rows affected//*** */
                resolve(id);

            reject('Job id ' + id + ' was not removed from queue');
        });
    });
}

module.exports = PersistentQueue;