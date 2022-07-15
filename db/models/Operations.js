const mongoose = require('../connect');
const schema = mongoose.Schema;


const operationSchema = new schema({
    pair: {
        type: String
    },

    totalSpent: {
        type: Number,
        default: 0
    },

    amount: {
        type: Number,
        default: 0
    },

    averageBuyPrice: {
        type: Number,
        default: 0
    },

    bayCount: {
        type: Number,
        default: 0
    },

    sellCount: {
        type: Number,
        default: 0
    },


}, { timestamps: true });

const operationModel = mongoose.model('operation', operationSchema);
module.exports = operationModel;

