import fs from 'fs';
import path from 'path';
import { Low, JSONFile } from 'lowdb';
import Big from 'big.js';

export class DatabaseLocal {
    constructor(uniqueName = 'default') {
        const dbFolder = path.resolve(process.cwd(), 'db');
        if (!fs.existsSync(dbFolder)) {
            fs.mkdirSync(dbFolder);
        }

        const fileName = `${uniqueName}-localDB.json`;
        const filePath = path.join(dbFolder, fileName);

        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
        }

        const adapter = new JSONFile(filePath);
        this.db = new Low(adapter);
        this._initialize();
    }

    async _initialize() {
        try {
            await this.db.read();
            if (!this.db.data) {
                console.log('DB is empty, initializing default values.');
                await this._initDefault();
            }
        } catch (error) {
            console.error(`Error initializing DB: ${error.message}`);
            await this._initDefault();
        }
    }

    async _initDefault() {
        this.db.data = {
            operationData: {
                averageBayPrice: 0,
                totalSpent: 0,
                amount: 0,
                fee: 0,
            },
            successfullyClosed: [],
        };
        await this.db.write();
    }

    async setData(quantity, price, fee = 0) {
        if (!quantity || !price || quantity <= 0 || price <= 0) return null;

        const { totalSpent = 0, amount = 0, fee: currentFee = 0 } = this.db.data.operationData;

        const totalSpentBig = new Big(totalSpent);
        const amountBig = new Big(amount);
        const feeBig = new Big(currentFee);

        const newTotalSpent = totalSpentBig.plus(new Big(quantity).times(new Big(price)));

        const newAmount = amountBig.plus(new Big(quantity));
        const newFee = feeBig.plus(new Big(fee));

        this.db.data.operationData.totalSpent = newTotalSpent.toNumber();
        this.db.data.operationData.amount = newAmount.toNumber();
        this.db.data.operationData.fee = newFee.toNumber();

        this.db.data.operationData.averageBayPrice = newAmount.gt(0) ? parseFloat(newTotalSpent.div(newAmount).toFixed(8)) : 0;

        await this.db.write();
    }

    async updateData(currentPrice) {
        const { amount = 0, fee = 0 } = this.db.data.operationData;

        this.db.data.successfullyClosed.push({
            amount,
            price: currentPrice,
            fee: fee * 2,
        });

        this.db.data.operationData = {
            averageBayPrice: 0,
            totalSpent: 0,
            amount: 0,
            fee: 0,
        };

        await this.db.write();
    }

    async cleanUp() {
        await this._initDefault();
    }

    async getData() {
        await this.db.read();
        return this.db?.data?.operationData;
    }
}
