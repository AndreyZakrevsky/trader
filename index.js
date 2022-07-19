require('dotenv').config();
const ccxt = require("ccxt");
const operationService = require("./services/operatin.service")
//const mongoose = require("./db/connect")


const computeBuyVolume = (baseBalance, marketPrice, limitVolumeUSDT) => {

    let counterVolume = 0;
    let necessaryUsdVolume = 0;

    while (necessaryUsdVolume < limitVolumeUSDT) {
        counterVolume++;
        necessaryUsdVolume = necessaryUsdVolume + (+marketPrice)
    }

    return (baseBalance >= (counterVolume * (+marketPrice))) ? counterVolume : null

};

//=========================================================================================================

const binanceClient = new ccxt.binance({
    apiKey: process.env.API_KEY_binance,
    secret: process.env.API_SECRET_binance,
    options: { adjustForTimeDifference: true }
})

// const gateClient = new ccxt.gateio({
//     apiKey: process.env.API_KEY_gate,
//     secret: process.env.API_SECRET_gate,
// })


class BinanceTrader {
    constructor(tradeConfig, binanceClient) {
        this.configTrade = tradeConfig
        this.binanceClient = binanceClient
        this.market = `${tradeConfig.asset}/${tradeConfig.base}`
        this.isCryptoTrading = !Boolean(tradeConfig.maxAssetOrderByUsd)
        this.averageBuyPrice = 0
        this.buyAmount = 0
        this.totalSpent = 0
        this.tickCount = 0

    }

    // == PUBLIC ==

    async tick() {
        while (true) {
            await this._sleep(this.configTrade.tickInterval)
            this.tickCount += 1
            await this._trade()
        }
    }

    //  == PRIVATE == //watchBalance 
    async _trade() {
        const baseBalance = await this._getBaseBalance()
        const assetBalance = await this._getAssetBalance()
        const { averageBuyPrice = null, totalSpent = 0, amount = 0 } = await operationService.get(this.market)

        this.averageBuyPrice = averageBuyPrice || 0
        this.buyAmount = amount
        this.totalSpent = totalSpent
        const currentMarketPrice = await this._getLastMarketPrice()
        if (!currentMarketPrice) return

        const minBuyVolume = this.isCryptoTrading ? this._computeBuyVolume(currentMarketPrice) : this.configTrade.maxAssetOrderByUsd

        console.log("AVERAGE BUY PRICE - ", this.averageBuyPrice, this.buyAmount)
        console.log("BAY CASE ", this.market, this.averageBuyPrice - this.configTrade.clearanceBuy, " >= ", currentMarketPrice)
        console.log("SELL CASE ", this.market, this.averageBuyPrice + this.configTrade.clearanceSell, " < ", currentMarketPrice)
       // this._showAssetData(currentMarketPrice)

        //console.log(averageBuyPrice, this.averageBuyPrice, minBuyVolume)
        if (!averageBuyPrice) {
            await this._buy(minBuyVolume, averageBuyPrice === null)
            return
        }

        const priceDifference = currentMarketPrice - Number(this.averageBuyPrice)

        if (priceDifference > 0) {
            if (this.averageBuyPrice + this.configTrade.clearanceSell < currentMarketPrice && assetBalance) {
                const amountToSell = Math.floor(assetBalance) ||  this.buyAmount
                await this._sell(amountToSell)
            }
        } else {

            if (this.isCryptoTrading) {
                if (!baseBalance || baseBalance < this.configTrade.maxOrderByUSD) return
            } else {
                if (!baseBalance || baseBalance < currentMarketPrice * minBuyVolume) return
            }

            if (this.averageBuyPrice - this.configTrade.clearanceBuy >= currentMarketPrice) {
                await this._buy(minBuyVolume)
            }
        }
       
    }

    async _sell(amount) {

        try {
            const { status } = await this.binanceClient.createMarketSellOrder(this.market, amount)
            if (status === "closed") {
                this._clearBuyData()
            }
        } catch (e) {
            console.log("SELL || ", e.message)
        }
    }

    async _buy(amount, isFirstTrade = false) {
        try {
            const { status, fee, cost } = await this.binanceClient.createMarketBuyOrder(this.market, amount)
            if (status === "closed") {
                this._setBuyAmounts(amount, cost, isFirstTrade)
            }
        } catch (e) {
            console.log("BUY || ", e.message)
        }
    }

    async _setBuyAmounts(buyAmount, cost, isFirstTrade) {
        const amount = isFirstTrade ? buyAmount : this.buyAmount + buyAmount
        const totalSpent = isFirstTrade ? cost : this.totalSpent + cost
        const averageBuyPrice = Number((totalSpent / amount).toFixed(4))

        if (isFirstTrade) {
            await operationService.create({ pair: this.market, totalSpent, averageBuyPrice, amount, bayCount: 1 })
            return
        }

        await operationService.update({ pair: this.market, totalSpent, averageBuyPrice, amount })
    }

    async _getBaseBalance() {
        try {
            const { info } = await this.binanceClient.fetchBalance({ type: 'account' })
            const { free } = info.balances.find((item) => item.asset === this.configTrade.base)
            return free ? Number(free) : null
        } catch (e) {
            console.log("BASE BALANCE || ", e.message)
            return null
        }
    }

    async _getAssetBalance() {
        try {
            const { info } = await this.binanceClient.fetchBalance({ type: 'account' })
            const { free } = info.balances.find((item) => item.asset === this.configTrade.asset)
            return free ? Number(free) : null
        } catch (e) {
            console.log("ASSET BALANCE || ", e.message)
            return null
        }
    }

    _computeBuyVolume(marketPrice) {

        let counterVolume = 0;
        let necessaryUsdVolume = 0;

        while (necessaryUsdVolume < this.configTrade.maxOrderByUSD) {
            counterVolume++;
            necessaryUsdVolume = necessaryUsdVolume + (+marketPrice)
        }

        return counterVolume
    }

    async _getLastMarketPrice() {
        try {
            const { info: { lastPrice = null } } = await this.binanceClient.fetchTicker(this.market)
            return Number(lastPrice);
        } catch (e) {
            return null
        }
    }

    _sleep(time) {
        return new Promise(resolve => setTimeout(resolve, time))
    }

    async _clearBuyData() {
        this.averageBuyPrice = 0
        this.buyAmount = 0
        this.totalSpent = 0
        await operationService.reset(this.market)
    }

    _showAssetData(currentPrice) {
        var today = new Date();
        let h = (today.getHours() < 10) ? "0" + today.getHours() : today.getHours();
        let m = (today.getMinutes() < 10) ? "0" + today.getMinutes() : today.getMinutes();
        let s = (today.getSeconds() < 10) ? "0" + today.getSeconds() : today.getSeconds();
        const data = {
            CURRNT_PRICE: currentPrice,
            AVERAGE_PRICE: this.averageBuyPrice,
            TOTAL_AMOUNT: this.buyAmount,
            TOTAL_SPENT: this.totalSpent,
        }
        console.log( h + ":" + m + ":" + s)
        console.table(data)
    }
}


const config = {
    asset: "BSW",
    base: "USDT",
    clearanceSell: 0.08,
    clearanceBuy: 0.02,
    tickInterval: 40000,
    maxOrderByUSD: 10
}

const configUAH = {
    asset: "USDT",
    base: "UAH",
    clearanceSell: 0.4,
    clearanceBuy: 0.25,
    tickInterval: 120000,
    maxOrderByUSD: 10,
    maxAssetOrderByUsd: 40,
}

const uahTrade = new BinanceTrader(configUAH, binanceClient)
uahTrade.tick()

const bswTrade = new BinanceTrader(config, binanceClient)
bswTrade.tick()



