require('dotenv').config();
const ccxt = require("ccxt");

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

const config = {
    asset: "DOGE",
    base: "USDT",
    clearanceSell: 0.01,
    clearanceBuy: 0.01,
    tickInterval: 15000,
    maxOrderByUSD: 10
}


const binanceClient = new ccxt.binance({
    apiKey: process.env.API_KEY,
    secret: process.env.API_SECRET,
    options: { adjustForTimeDifference: true }
})

class BinanceTrader {
    constructor(tradeConfig, binanceClient) {
        this.configTrade = tradeConfig
        this.binanceClient = binanceClient
        this.market = `${tradeConfig.asset}/${tradeConfig.base}`
        this.averageBuyPrice = 0
        this.buyAmount = 0
        this.totalSpent = 0

    }

    // == PUBLIC ==

    async tick() {
        while (true) {
            await this._sleep(this.configTrade.tickInterval)
            const baseBalance = await this._getBaseBalance()
            if(!baseBalance || baseBalance < this.configTrade.maxOrderByUSD) continue
            this._trade()
        }
    }

    //  == PRIVATE == //watchBalance 
    async _trade() {
        const currentMarketPrice = await this._getLastMarketPrice()
        if (!currentMarketPrice) return

        const minBuyVolume = this._computeBuyVolume(currentMarketPrice)

        if (this.averageBuyPrice === 0) {
            await this._buy(minBuyVolume)
            return
        }
        const priceDifference = currentMarketPrice - Number(this.averageBuyPrice)

        if (priceDifference > 0) {
            if (this.averageBuyPrice + this.configTrade.clearanceSell < currentMarketPrice) {
                console.log("SELLLL  ", this.averageBuyPrice + this.configTrade.clearanceSell, currentMarketPrice)
                await this._sell(this.buyAmount)
            }
        } else {
            if (this.averageBuyPrice - this.configTrade.clearanceBuy >= currentMarketPrice) {
                await this._buy(minBuyVolume)
            }
        }
        this._showAssetData(currentMarketPrice)
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

    async _buy(amount) {
        try {
            const { status, fee, price, cost } = await this.binanceClient.createMarketBuyOrder(this.market, amount)
            if (status === "closed") {
                this._setBuyAmounts(amount - Number(fee.cost), cost)
            }
        } catch (e) {
            console.log("BUY || ", e.message)
        }
    }

    _setAverageBuyPrice() {
        this.averageBuyPrice = Number((this.totalSpent / this.buyAmount).toFixed(4))
    }

    _setBuyAmounts(amount, cost) {
        this.buyAmount = this.buyAmount + amount
        this.totalSpent = this.totalSpent + cost
        this._setAverageBuyPrice()
    }

    _sleep(time) {
        return new Promise(resolve => setTimeout(resolve, time))
    }

    _clearBuyData() {
        this.averageBuyPrice = 0
        this.buyAmount = 0
        this.totalSpent = 0
    }

    _showAssetData(currentPrice) {
        const data = {
            CURRNT_PRICE: currentPrice,
            AVERAGE_PRICE: this.averageBuyPrice,
            TOTAL_AMOUNT: this.buyAmount,
            TOTAL_SPENT: this.totalSpent,
        }
        console.table(data)
    }
}

const binanceTrader = new BinanceTrader(config, binanceClient)

//binanceTrader.tick()