const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const TOML = require('@ltd/j-toml');
const initSqlJs = require('../../lib/sqlite/sql-wasm');

const rootPath = './';

const sqlPromise = initSqlJs({
    locateFile: (file) => `./lib/sqlite/${file}`
});

let SQL;
let db;

Promise.all([sqlPromise]).then((result) => {
    console.log('sqlite init done.');
    SQL = result[0];
    init(new Date()).catch((e) => {
        console.log('init error', e);
    });
});

async function init(now) {
    let filePath = path.resolve(rootPath, 'config.toml');
    console.log('config file path:', filePath);
    let buffer = fs.readFileSync(filePath);
    let text = buffer.toString();
    let config = TOML.parse(text);
    for (let key of Object.keys(config.sources)) {
        let source = config.sources[key];
        if (source.enable) {
            if (now.getHours() % parseInt(source.frequency) === 0) {
                let dbPath = path.resolve(rootPath, 'db', key + '.db');
                console.log(`${source.name} db path: ${dbPath}`);
                let buf = fs.readFileSync(dbPath);
                db = new SQL.Database(new Uint8Array(buf));
                await get(source.url);
                fs.writeFileSync(dbPath, Buffer.from(db.export()));
            }
        }
    }
}

async function get(url) {
    console.log(`    start fetch: ${url}`);
    try {
        let resp = await axios.get(url, {
            headers: {
                Accept: 'application/xml'
            }
        });
        if (resp.data) {
            let data = resp.data.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&');
            const $ = await cheerio.load(data, { xmlMode: true });
            let arr = [];
            $('rss channel item').each((a, b) => {
                const title = $(b).find('title').text();
                const link = $(b).find('link').text();
                const description = $(b).find('description').text();
                const pubDate = $(b).find('pubDate').text();
                let time = '';
                if (pubDate) {
                    time += new Date(pubDate).getTime();
                }
                if (title) {
                    arr.push({ time, link, title, description });
                }
            });
            saveToDb(arr);
        }
    } catch (e) {
        console.warn(e);
    }
}

function saveToDb(datas) {
    let lastId = 0;
    try {
        const stmt = db.prepare('select max(TIME) from data');
        while (stmt.step()) {
            lastId = stmt.get()[0];
        }
    } catch (e) {}
    console.log(`    get ${datas.length} data`);
    datas.sort((a, b) => {
        if (a.time > b.time) {
            return 1;
        } else if (a.time < b.time) {
            return -1;
        } else {
            return 0;
        }
    });
    let saveCount = 0;
    for (let data of datas) {
        try {
            if (data.time > lastId) {
                db.run('insert into data values (?, ?, ?, ?)', [data.time, data.link, data.title, data.description]);
                saveCount++;
            }
        } catch (e) {
            console.info('    save error:', e.message);
        }
    }
    console.log(`    save ${saveCount} data`);
}
