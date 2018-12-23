const stocks = require('yahoo-stocks');
const Parser = require('rss-parser');
const express = require('express');
const app = express();
const parser = new Parser();

const opt = {
    interval : '1d',
    range : '5y'
}

Date.prototype.getDateFormat = function(){
    return this.toISOString().slice(0,10);
}

Date.prototype.getDiffDateFormat = function(diffDate){
    newDate = new Date(this.getTime());
    newDate.setDate(newDate.getDate() + diffDate);
    return newDate.getDateFormat();
}

function get_average_price(end_day, period){
    var sum = 0;
    var weight = 0;
    var divide = 0;

    for(var i = 1 ; i <= period ; i++){
        iday = end_day.getDiffDateFormat(-i);
        weight++;

        if(iday in server_data){
            sum += weight*server_data[iday][3];
            divide += weight;
            weight = 0;
        }
    }

    return sum / divide;
}

var recent = ["AAPL", "MSFT", "AMZN", "NFLX", "FB"];
var freqency = {
    AAPL : 10,
    MSFT : 3,
    AMZN : 4,
    NFLX : 15,
    FB : 23
};

app.set("view engine", 'ejs');

app.use(express.static('public'));

app.get('/', (req, res) => {
    var freq_sort = Object.keys(freqency).map((key) => {
        return [key, freqency[key]];
    });

    freq_sort.sort((a, b) => {
        return b[1] - a[1];
    });

    var data = {
        code_recent : recent,
        code_freqency : freq_sort.slice(0, 5)};
    res.render('index', data);
})

app.get('/favicon.ico', (req, res) => {

})

app.get('/:stock_code', (req, res) => {
    var data = {
        stock_code : req.params.stock_code,
        stock_name : "",
        stock_data_daily : {},
        stock_data_weekly : {},
        analysis : [false, false, false],
        macd : 0,
        stock_news : []
    }

    //check STOCK_CODE:
    stocks.lookup(data.stock_code).then(response =>{
        //update recent & freq.
        if(recent.indexOf(data.stock_code) == -1){
            recent.unshift(data.stock_code);
        }
        if(recent.length > 5){
            recent.pop();
        }

        if(data.stock_code in freqency){
            freqency[data.stock_code]++;
        }else{
            freqency[data.stock_code] = 1;
        }

        data.stock_name = response.name;
        //Download stock dat
        var stockhistory = stocks.history(data.stock_code, opt).then(response =>{
            server_data = {};
            response.records.forEach(record => {
                record_date = new Date(record.time * 1000)
                server_data[record_date.getDateFormat()] = [
                    parseFloat(record.open),
                    parseFloat(record.high),
                    parseFloat(record.low),
                    parseFloat(record.close)
                ];
            })

            //daily. 0-open 1-high 2-low 3-close 4-wa3m 5-wa1m.
            var today = new Date();
            today.setHours(today.getHours() + 1);
            var aday = new Date();
            aday.setDate(aday.getDate() -90);
            while(aday <= today){
                if(aday.getDateFormat() in server_data){
                    //wa
                    wa = 0.0;
                    weight = 0;
                    divide = 0;
                    for(var i = 1 ; i <= 60 ; i++){
                        iday = aday.getDiffDateFormat(-i);
                        weight += 61 - i
                        if(iday in server_data){
                            wa += weight * server_data[iday][3];
                            divide += weight;
                            weight = 0;
                        }
                    }
                    wa /= divide;

                    //wa1m
                    data.stock_data_daily[aday.getDateFormat()] = [
                        server_data[aday.getDateFormat()][0],
                        server_data[aday.getDateFormat()][1],
                        server_data[aday.getDateFormat()][2],
                        server_data[aday.getDateFormat()][3],
                        wa
                    ]
                }
                aday.setDate(aday.getDate()  + 1);
            }
            for(var i = 1 ; i <= 30 ; i++){
                wa = 0.0;
                weight = 0;
                divide = 0;
                for(var j = 1; j <= 60; j++){
                    jday = aday.getDiffDateFormat(-j);
                    weight += 61 - j;
                    if(jday in data.stock_data_daily){
                        if(data.stock_data_daily[jday][3] != null){
                            wa += weight * data.stock_data_daily[jday][3];
                        }else{
                            wa += weight * data.stock_data_daily[jday][4];
                        }
                        divide += weight;
                        weight = 0;
                    }
                }
                wa /= divide;

                data.stock_data_daily[aday.getDateFormat()] = [null, null, null, null, wa];
                aday.setDate(aday.getDate() + 1);
            }
            //calc MACD & signal
            aday = new Date();
            aday.setDate(aday.getDate() - aday.getDay() - 400);
            console.log(aday.getDay());
            emv12 = server_data[aday.getDateFormat()][3]
            emv26 = server_data[aday.getDateFormat()][3]
            macd = 0;
            signal = 0;
            aday.setDate(aday.getDate() + 1);
            while(aday <= today){
                if(aday.getDateFormat() in server_data){
                    emv12 = 1/13*emv12 + 12/13*server_data[aday.getDateFormat()][3];
                    emv26 = 1/27*emv26 + 26/27*server_data[aday.getDateFormat()][3];
                    macd = emv12 - emv26;
                    signal = 1/10*signal + 9/10*macd;
                    server_data[aday.getDateFormat()].push(macd);
                    server_data[aday.getDateFormat()].push(signal);
                }
                aday.setDate(aday.getDate() + 1);
            }

            //weekly. 0-open 1-high 2-low 3-clse 4-20avg 5-120avg 6-200avg 7-macd 8-signal 9-osilator.
            //set a day to friday.
            aday = new Date();
            aday.setDate(aday.getDate() - 365);
            aday.setDate(aday.getDate() - aday.getUTCDay() + 5);
            macd_star = [false, false, false];
            prev_macd = 0;
            prev_signal = 0;
            while(aday <= today){
                open = undefined;
                high = undefined;
                low = undefined;
                close = undefined;
                macd = undefined;
                signal = undefined;
                for(var i = 4 ; i >= 0 ; i--){
                    iday = aday.getDiffDateFormat(-i);
                    if(iday in server_data){
                        if(open == undefined){
                            open = server_data[iday][0];
                        }

                        close = server_data[iday][3];
                        macd = server_data[iday][4];
                        signal = server_data[iday][5];

                        if(server_data[iday][1] > high || high == undefined){
                            high = server_data[iday][1]
                        }

                        if(server_data[iday][2] < low || low == undefined){
                            low = server_data[iday][2];
                        }
                    }
                }

                if(macd > 0 && prev_macd < macd){
                    macd_star[0] = true;
                }else{
                    macd_star[0] = false;
                }

                if(prev_macd < prev_signal && macd > signal){
                    macd_star[1] = true;
                }else{
                    macd_star[1] = false;
                }

                if(prev_macd < 0 && macd > 0){
                    macd_star[2] = true;
                }else{
                    macd_star[2] = false;
                }

                avg20 = get_average_price(aday, 20);
                avg120 = get_average_price(aday, 120);
                avg200 = get_average_price(aday, 200);

                data.stock_data_weekly[aday.getDateFormat()] = [
                    open, high, low, close, avg20, avg120, avg200, macd, signal
                ]

                prev_macd = macd;
                prev_signal = signal;

                aday.setDate(aday.getDate() + 7);
            }

            macd_star.forEach(item => {
                if(item){
                    data.macd++;
                }
            })

            if(macd_star[0]){
                if(macd > signal){
                    data.macd++;
                }
            }

            if(avg20 > avg200){
                data.analysis[0] = true;
            }
            if(avg20 > avg120){
                data.analysis[1] = true;
            }else{
                if(macd < signal){
                    data.macd++;
                }
            }
            if(wa > response.records.pop().close){
                data.analysis[2] = true;
            }
        })

        //Get Stocknews
        var stocknews = parser.parseURL(
            'https://feeds.finance.yahoo.com/rss/2.0/headline?s=' + data.stock_code
        ).then( feed => {
            feed.items.forEach( entry => {
                data.stock_news.push({
                    title : entry.title,
                    link : entry.link
                })
            })
        });

        var freq_sort = Object.keys(freqency).map((key) => {
            return [key, freqency[key]];
        });

        freq_sort.sort((a, b) => {
            return b[1] - a[1];
        });

        data['code_recent'] = recent;
        data['code_freqency'] = freq_sort.slice(0,5);

        Promise.all([stockhistory, stocknews]).then( () => {
            res.render('stock',data);
        })

    }).catch(err => {
        console.log(err);
        //Error or Stock is not exist
        res.render('404');
    });


})

app.listen(3000, () => {
    console.log("Listen Start");
})
