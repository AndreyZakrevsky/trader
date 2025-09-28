const mongoose = require('mongoose');
const UserModel = require('../models/User');
const ReactionModel = require('../models/Reaction');
const MatchModel = require('../models/Match');
const ProfilesLimit = require('../models/ProfilesDailyLimit');
const ExploreLimit = require('../models/ExploreDailyLimit');
const BlackList = require('../models/BlackList');
const FirebaseModal = require('../models/FirebaseToken');
const ChatRoomModel = require('../models/Room');
const ExploreReactedList = require('../models/ExploreUsersReactedList');
const ReportWithReason = require('../models/ReportWithReason');
const Slide = require('../models/Slide');
const ReportProblem = require('../models/ProblemReport');
const { customLogger } = require('../logger');
const { v4 } = require('uuid');
const dateHelper = require('../utils/timeConverter');

const UserRepository = class {
    constructor() {
        this.model = UserModel;
        this.reactionModel = ReactionModel;
        this.matchModel = MatchModel;
        this.profilesLimitModel = ProfilesLimit;
        this.exploreLimitModel = ExploreLimit;
        this.blackListModel = BlackList;
        this.firebaseModel = FirebaseModal;
        this.chatModel = ChatRoomModel;
        this.exploreReactedListModel = ExploreReactedList;
        this.reportWithReasonModel = ReportWithReason;
        this.slideModal = Slide;
        this.reportProblemModal = ReportProblem;
    }

    async createNewMatch(members, isHidden = false) {
        let newMatchId = v4();
        try {
            let firstMemberFounded = await this.matchModel.findOne({ userId: members[0], oppositeUserId: members[1] });
            let secondMemberFounded = await this.matchModel.findOne({ userId: members[1], oppositeUserId: members[0] });
            if (firstMemberFounded && secondMemberFounded) {
                if (isHidden) {
                    firstMemberFounded = await this.matchModel.findOneAndUpdate(
                        {
                            userId: members[0],
                            oppositeUserId: members[1],
                        },
                        { isHidden: true },
                        {
                            new: true,
                        }
                    );
                    secondMemberFounded = await this.matchModel.findOneAndUpdate(
                        {
                            userId: members[1],
                            oppositeUserId: members[0],
                        },
                        { isHidden: true },
                        {
                            new: true,
                        }
                    );
                    return [firstMemberFounded.transform(), secondMemberFounded.transform()];
                } else {
                    return [firstMemberFounded.transform(), secondMemberFounded.transform()];
                }
            }
        } catch (e) {
            return { message: e.message };
        }

        try {
            let userFirst = await this.model.findById(members[0]);
            let userSecond = await this.model.findById(members[1]);
            let firstUserRoom = 1;
            let secondUserRoom = 1;
            let chatRoom = await this.chatModel.find({ pair: { $all: members } });
            chatRoom.map((chat) => {
                if (chat.userId === members[0]) {
                    firstUserRoom = chat;
                }
                if (chat.userId === members[1]) {
                    secondUserRoom = chat;
                }
            });

            let newMatchFirstMember = {
                userId: members[0],
                matchId: newMatchId,
                oppositeUserId: members[1],
                user: userSecond,
                room: firstUserRoom,
            };
            let newMatchSecondMember = {
                userId: members[1],
                matchId: newMatchId,
                oppositeUserId: members[0],
                user: userFirst,
                room: secondUserRoom,
            };
            if (isHidden) {
                newMatchSecondMember.isHidden = isHidden;
                newMatchFirstMember.isHidden = isHidden;
            }
            let matchFirstMemberSaved = await new this.matchModel(newMatchFirstMember).save();
            let matchSecondMemberSaved = await new this.matchModel(newMatchSecondMember).save();
            if (matchFirstMemberSaved && matchSecondMemberSaved) {
                return [matchFirstMemberSaved.transform(), matchSecondMemberSaved.transform()];
            } else return null;
        } catch (e) {
            return { message: e.message };
        }
    }

    async getUserById(user_id) {
        let userData;
        try {
            userData = await this.model.findById(user_id);
            if (userData) {
                return userData.transform();
            } else {
                return userData;
            }
        } catch (e) {
            return { message: e.message };
        }
    }

    async getUserByPhone(number) {
        let userData;
        try {
            userData = await this.model.findOne({ phoneNumber: number });
            if (userData) {
                return userData.transform();
            } else {
                return userData;
            }
        } catch (e) {
            return { message: e.message };
        }
    }

    async getUserByFirebaseId(id) {
        let userData;
        try {
            userData = await this.model.findOne({ firebaseId: id });
            if (userData) {
                return userData.transform();
            } else {
                return userData;
            }
        } catch (e) {
            return { message: e.message };
        }
    }

    async saveUserData(user_id, data) {
        let user = Object.assign({}, data);
        Object.keys(user).map((field) => {
            if (user[field] === null) {
                delete user[field];
            }
        });
        if (data.birthday) {
            let ageDifMs = Date.now() - data.birthday * 1000;
            let ageDate = new Date(ageDifMs);
            user.age = Math.abs(ageDate.getUTCFullYear() - 1970);
        }
        if (data.lng && data.lat) {
            user.lng = +data.lng;
            user.lat = +data.lat;
            user.location = {
                type: 'Point',
                coordinates: [+data.lng, +data.lat],
            };
        }

        let userData;
        try {
            userData = await this.model.findOneAndUpdate({ _id: user_id }, user, {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
            });
        } catch (e) {
            return { message: e.message };
        }
        return userData.transform();
    }

    async createNewUser(data) {
        let newUser = { firebaseId: data.uid };
        if (data.phone_number) {
            newUser.phoneNumber = data.phone_number;
        }
        try {
            let user = new this.model(newUser);
            await user.save();

            if (user) {
                let profLimit = new this.profilesLimitModel({
                    userId: user._id.toString(),
                });
                let exploreLimit = new this.exploreLimitModel({
                    userId: user._id.toString(),
                });

                await profLimit.save();
                await exploreLimit.save();
                return user.transform();
            } else {
                return user;
            }
        } catch (e) {
            return { message: e.message };
        }
    }

    async findUsersProfiles(user_id, limit, withReactions) {
        let userData;
        let matchUsers;
        let reactedUsers = [];
        let roomExistWith = [];
        let usersSentSlideToME = [];
        let usersSentSlideToMEIds = [];
        if (withReactions) {
            try {
                reactedUsers = await this.reactionModel.find({ userId: user_id }); // My reactions
                reactedUsers = reactedUsers.map((user) => user.oppositeUserId);
                reactedUsers = reactedUsers.map((id) => mongoose.Types.ObjectId(id));
            } catch (e) {
                console.log(e.message);
            }

            try {
                let roomExist = [];
                roomExistWith = await this.chatModel.find({ userId: user_id }).select('pair');
                roomExistWith = roomExistWith.map((item) => {
                    roomExist = roomExist.concat(item.pair);
                });
                if (roomExist && roomExist.length > 0) {
                    roomExistWith = roomExist.filter((id) => id !== user_id);
                    roomExistWith = roomExistWith.map((id) => mongoose.Types.ObjectId(id));
                    reactedUsers = reactedUsers.concat(roomExistWith);
                }
            } catch (e) {
                console.log(e.message);
            }

            try {
                let userBlackList = await this.blackListModel.findOne({ userId: user_id });
                if (userBlackList && userBlackList.blackList) {
                    userBlackList = userBlackList.blackList.map((id) => mongoose.Types.ObjectId(id));
                    userBlackList = userBlackList.filter((id) => {
                        return mongoose.Types.ObjectId.isValid(id);
                    });
                    reactedUsers = reactedUsers.concat(userBlackList);
                }
            } catch (e) {
                console.log(e.message);
            }
        }

        try {
            usersSentSlideToME = await this.slideModal.find({ oppositeUserId: user_id, userId: { $nin: reactedUsers } });
            if (usersSentSlideToME && usersSentSlideToME.length > 0) {
                usersSentSlideToMEIds = usersSentSlideToME.map((userSentSlide) => userSentSlide.userId);
                usersSentSlideToMEIds = usersSentSlideToMEIds.map((item) => mongoose.Types.ObjectId(item));
                usersSentSlideToME = await this.model.find({ _id: { $in: usersSentSlideToMEIds } });
                usersSentSlideToME = usersSentSlideToME.map((user) => user.transform());
                limit = limit - usersSentSlideToME.length;
            } else {
                usersSentSlideToME = [];
            }
        } catch (e) {
            usersSentSlideToME = [];
        }

        if (usersSentSlideToMEIds && usersSentSlideToMEIds.length > 0) {
            reactedUsers = reactedUsers.concat(usersSentSlideToMEIds);
            reactedUsers = reactedUsers.map((item) => item.toString());
            reactedUsers = reactedUsers.filter((elem, index, self) => {
                return index === self.indexOf(elem);
            });
            reactedUsers = reactedUsers.map((item) => mongoose.Types.ObjectId(item));
        } else {
            reactedUsers = reactedUsers.map((item) => item.toString());
            reactedUsers = reactedUsers.filter((elem, index, self) => {
                return index === self.indexOf(elem);
            });
            reactedUsers = reactedUsers.map((item) => mongoose.Types.ObjectId(item));
        }

        reactedUsers.push(mongoose.Types.ObjectId(user_id));
        try {
            userData = await this.model.findById(user_id);

            let searchOptions = {
                moment: { $exists: true },
                height: {
                    $gte: Math.floor(userData.minHeightRange * 100) / 100,
                    $lte: Math.round(userData.maxHeightRange * 100) / 100,
                },
                lat: { $ne: 0 },
                lng: { $ne: 0 },
                birthday: {
                    $gte: dateHelper.ageToSeconds(userData.maxAgeRange),
                    $lte: dateHelper.ageToSeconds(userData.minAgeRange),
                },
            };

            if (reactedUsers && reactedUsers.length > 0) {
                searchOptions._id = { $nin: reactedUsers };
            }

            if (userData.ethnicityLookingFor && userData.ethnicityLookingFor.length > 0 && userData.ethnicityLookingFor.indexOf('other') === -1) {
                searchOptions.ethnicity = { $in: userData.ethnicityLookingFor };
            }

            if (userData.genderLookingFor && userData.genderLookingFor.length > 0 && userData.genderLookingFor.indexOf('other') === -1) {
                searchOptions.gender = { $in: userData.genderLookingFor };
            }

            if (userData.lat && userData.lng) {
                if (userData.distanceLookingFor === 100000) {
                    userData.distanceLookingFor = 50000000;
                }
                if (withReactions) {
                    searchOptions.location = {
                        $nearSphere: {
                            $geometry: {
                                type: 'Point',
                                coordinates: [Number(userData.lng), Number(userData.lat)],
                            },
                            $maxDistance: userData.distanceLookingFor,
                            $minDistance: 0,
                        },
                    };
                } else {
                    searchOptions.location = {
                        $nearSphere: {
                            $geometry: {
                                type: 'Point',
                                coordinates: [Number(userData.lng), Number(userData.lat)],
                            },
                            $maxDistance: Number(process.env.LOCATION_DISTANCE_DEFAULT),
                            $minDistance: 0,
                        },
                    };
                }
            }

            if (userData) {
                if (usersSentSlideToME && usersSentSlideToME.length > limit) {
                    usersSentSlideToME = usersSentSlideToME.filter((user, i) => {
                        return i < limit;
                    });
                    return usersSentSlideToME;
                } else {
                    matchUsers = await this.model.find(searchOptions).limit(limit);
                    if (matchUsers) {
                        let res = matchUsers.map((match) => match.transform());
                        return res.concat(usersSentSlideToME);
                    } else {
                        return { message: 'Users are not found !' };
                    }
                }
            } else {
                return [];
            }
        } catch (e) {
            console.log(e.message);
            return { message: e.message };
        }
    }

    async findUsersExplore(user_id) {
        let userData;
        let matchUsers;
        let userExploreLimit;
        let limit = 0;
        let userBlackList = [];
        let profilesExclude = [];
        let reactedUsers = [];
        let roomExist = [];
        let roomExistWith = [];

        //Find users that can I see at all profiles
        try {
            profilesExclude = await this.findUsersProfiles(user_id, 25, true);
            if (profilesExclude && profilesExclude.length > 0) {
                profilesExclude = profilesExclude.map((user) => user.id);
            } else {
                profilesExclude = [];
            }

            userBlackList = await this.exploreReactedListModel.findOne({ userId: user_id });
            if (userBlackList && userBlackList.list && userBlackList.list.length > 0) {
                userBlackList = userBlackList.list.map((id) => mongoose.Types.ObjectId(id));
                profilesExclude = profilesExclude.concat(userBlackList);
            }
        } catch (e) {
            console.log(e);
        }

        //Find users that I have reacted
        try {
            reactedUsers = await this.reactionModel.find({ userId: user_id });
            if (reactedUsers && reactedUsers.length > 0) {
                reactedUsers = reactedUsers.map((user) => user.oppositeUserId);
                reactedUsers = reactedUsers.map((id) => mongoose.Types.ObjectId(id));
                profilesExclude = profilesExclude.concat(reactedUsers);
            }
        } catch (e) {
            console.log(e.message);
        }

        // Chat already exist
        try {
            roomExistWith = await this.chatModel.find({ userId: user_id }).select('pair');
            if (roomExistWith && roomExistWith.length > 0) {
                roomExistWith = roomExistWith.map((item) => {
                    roomExist = roomExist.concat(item.pair);
                });
                roomExistWith = roomExist.filter((id) => id !== user_id);
                roomExistWith = roomExistWith.map((id) => mongoose.Types.ObjectId(id));
                profilesExclude = profilesExclude.concat(roomExistWith);
            }
        } catch (e) {
            console.log(e.message);
        }

        // Avoid duplicate of id's
        profilesExclude.push(mongoose.Types.ObjectId(user_id));

        if (profilesExclude && profilesExclude.length > 0) {
            profilesExclude = profilesExclude.map((item) => item.toString());
            profilesExclude = profilesExclude.filter((elem, index, self) => {
                return index === self.indexOf(elem);
            });
            profilesExclude = profilesExclude.map((item) => mongoose.Types.ObjectId(item));
        }

        try {
            userData = await this.model.findById(user_id);
            userExploreLimit = await this.exploreLimitModel.findOne({ userId: user_id });
            if (userExploreLimit && userExploreLimit.limit && userExploreLimit.limit > 0) {
                limit = userExploreLimit.limit;
            }

            let searchOptions = {
                _id: { $nin: profilesExclude },
                moment: { $exists: true },
            };

            if (userData.genderLookingFor && userData.genderLookingFor.length > 0 && userData.genderLookingFor.indexOf('other') === -1) {
                searchOptions.gender = { $in: userData.genderLookingFor };
            }

            if (userData && userData.birthday) {
                let age = dateHelper.ageByBirthday(userData.birthday);
                if (age) {
                    searchOptions.birthday = {
                        $gte: Number(dateHelper.ageToSeconds(age + 5)),
                        $lte: Number(dateHelper.ageToSeconds(age - 5)),
                    };
                }
            }

            if (userData && limit > 0) {
                matchUsers = await this.model.find(searchOptions).limit(limit);
                if (matchUsers && matchUsers.length > 0) {
                    return matchUsers.map((profile) => profile.transform());
                } else {
                    return [];
                }
            } else {
                return [];
            }
        } catch (e) {
            return { message: e.message };
        }
    }

    async findUserMatches(user_id) {
        let matches;
        try {
            matches = await this.matchModel.find({ userId: user_id }).populate({
                path: 'room user',
                populate: {
                    path: 'user',
                    model: 'user',
                },
            });
            if (matches) {
                let filteredMatches = matches.map((match) => match.transform());
                return filteredMatches.map((match) => {
                    let tmp = match;
                    tmp.user.id = tmp.user._id;
                    tmp.room.user.id = tmp.room.user._id;
                    return tmp;
                });
            } else {
                return matches;
            }
        } catch (e) {
            return { message: e.message };
        }
    }

    async findUserReaction(user_id, oppositeUserId) {
        try {
            const reaction = await this.reactionModel.findOne({ userId: user_id, oppositeUserId: oppositeUserId });
            return reaction.transform();
        } catch (e) {
            return { message: e.message };
        }
    }

    async saveUserReaction(user_id, reactionData) {
        try {
            const reaction = await this.reactionModel({
                userId: user_id,
                oppositeUserId: reactionData.user,
                kind: reactionData.kind,
            }).save();
            return reaction.transform();
        } catch (e) {
            return { message: e.message };
        }
    }

    async findUserOwnExistReactions(user_id) {
        try {
            return await this.reactionModel.find({ userId: user_id }).select('oppositeUserId');
        } catch (e) {
            return { message: e.message };
        }
    }

    async updateUserReaction(user_id, oppositeUserId, type) {
        try {
            const reaction = await this.reactionModel.findOneAndUpdate(
                {
                    userId: user_id,
                    oppositeUserId: oppositeUserId,
                },
                { kind: type },
                { new: true }
            );

            if (reaction) {
                return reaction.transform();
            } else return null;
        } catch (e) {
            return { message: e.message };
        }
    }

    async updateMatchesStatuses(match_id) {
        try {
            const matchesStatuses = await this.matchModel.updateMany(
                {
                    matchId: match_id,
                },
                { isHidden: true }
            );

            if (matchesStatuses) {
                return matchesStatuses.transform();
            } else return null;
        } catch (e) {
            return { message: e.message };
        }
    }

    async updateMatchesStatusesByIds(user_id, oppositeUserId) {
        try {
            const matchesStatusesFirst = await this.matchModel.updateOne(
                {
                    userId: user_id,
                    oppositeUserId: oppositeUserId,
                },
                { isHidden: true }
            );
            await this.matchModel.updateOne(
                {
                    userId: oppositeUserId,
                    oppositeUserId: user_id,
                },
                { isHidden: true }
            );

            if (matchesStatusesFirst) {
                return matchesStatusesFirst.transform();
            } else return null;
        } catch (e) {
            return { message: e.message };
        }
    }

    async unmatchWithUser(user_id, oppositeUserId) {
        try {
            await this.matchModel.deleteOne({ userId: oppositeUserId, oppositeUserId: user_id });
            return await this.matchModel.deleteOne({ userId: user_id, oppositeUserId: oppositeUserId });
        } catch (e) {
            return { message: e.message };
        }
    }

    async updateUsersProfilesLimits() {
        try {
            await this.exploreLimitModel.updateMany({ limit: 15 });
            return await this.profilesLimitModel.updateMany({ limit: 25 });
        } catch (e) {
            return { message: e.message };
        }
    }

    async updateOwnProfilesLimitDec(user_id) {
        try {
            return await this.profilesLimitModel.findOneAndUpdate({ userId: user_id }, { $inc: { limit: -1 } });
        } catch (e) {
            return { message: e.message };
        }
    }

    async updateOwnExploreLimitDec(user_id) {
        try {
            return await this.exploreLimitModel.findOneAndUpdate({ userId: user_id }, { $inc: { limit: -1 } });
        } catch (e) {
            return { message: e.message };
        }
    }

    async addUserToBlackList(user_id, oppositeUserId) {
        try {
            return await this.blackListModel.findOneAndUpdate(
                { userId: user_id },
                { $push: { blackList: oppositeUserId } },
                {
                    new: true,
                    upsert: true,
                }
            );
        } catch (e) {
            return { message: e.message };
        }
    }

    async addUserExploreReactionOnList(user_id, oppositeUserId) {
        try {
            if (oppositeUserId && oppositeUserId.length > 23 && oppositeUserId.length < 25) {
                await this.updateOwnExploreLimitDec(user_id);
                return await this.exploreReactedListModel.findOneAndUpdate(
                    { userId: user_id },
                    { $push: { list: oppositeUserId } },
                    {
                        new: true,
                        upsert: true,
                    }
                );
            } else {
                return { message: 'Id is not valid !' };
            }
        } catch (e) {
            return { message: e.message };
        }
    }

    async removeUserData(user_id) {
        let removedUser;
        try {
            removedUser = await this.model.findByIdAndDelete(user_id);
        } catch (e) {
            customLogger(`User was not deleted !  ${e.message}`, __file, __line, 'Error');
            return { message: e.message };
        }

        try {
            await this.reactionModel.deleteMany({ userId: user_id });
        } catch (e) {
            customLogger(`User reactions were not deleted !  ${e.message}`, __file, __line, 'Error');
        }

        try {
            await this.reactionModel.deleteMany({ oppositeUserId: user_id });
        } catch (e) {
            customLogger(`User reactions were not deleted !  ${e.message}`, __file, __line, 'Error');
        }

        try {
            await this.matchModel.deleteMany({ userId: user_id });
        } catch (e) {
            customLogger(`User matches were not deleted !  ${e.message}`, __file, __line, 'Error');
        }

        try {
            await this.matchModel.deleteMany({ oppositeUserId: user_id });
        } catch (e) {
            customLogger(`User matches were not deleted !  ${e.message}`, __file, __line, 'Error');
        }

        try {
            await this.profilesLimitModel.deleteMany({ userId: user_id });
        } catch (e) {
            customLogger(`User limites were not deleted !  ${e.message}`, __file, __line, 'Error');
        }

        try {
            await this.exploreLimitModel.deleteMany({ userId: user_id });
        } catch (e) {
            customLogger(`User limites were not deleted !  ${e.message}`, __file, __line, 'Error');
        }

        try {
            await this.blackListModel.deleteMany({ userId: user_id });
        } catch (e) {
            customLogger(`User black-list was not deleted !  ${e.message}`, __file, __line, 'Error');
        }

        return removedUser;
    }

    async getOppositeUserReactions(user_id) {
        try {
            return await this.reactionModel.find({ oppositeUserId: user_id, kind: 'MATCH' }).select('userId');
        } catch (e) {
            return { message: e.message };
        }
    }

    async saveUserNotificationToken(user_id, token) {
        try {
            let tokenFb = await this.firebaseModel.findOneAndUpdate(
                { token: token },
                {
                    userId: user_id,
                    token: token,
                },
                { upsert: true, new: true }
            );
            return tokenFb;
        } catch (e) {
            return { message: e.message };
        }
    }

    async getUserFirebaseTokens(oppositeUserId) {
        try {
            return await this.firebaseModel.find({ userId: oppositeUserId });
        } catch (e) {
            return { message: e.message };
        }
    }

    async removeUserFirebaseToken(token) {
        try {
            return await this.firebaseModel.deleteOne({ token: token });
        } catch (e) {
            return { message: e.message };
        }
    }

    async getDailyProfilesLimit(user_id) {
        try {
            let userProfilesLimit = await this.profilesLimitModel.findOne({ userId: user_id });
            if (userProfilesLimit && userProfilesLimit.limit && userProfilesLimit.limit > 0) {
                return userProfilesLimit.limit;
            }
            return 0;
        } catch (e) {
            return 0;
        }
    }

    async saveReportWithReason(user_id, oppositeUserId, reason) {
        let reportData = { userId: user_id, oppositeUserId: oppositeUserId };
        if (reason) {
            reportData.reason = reason;
        }
        try {
            let report = new this.reportWithReasonModel(reportData);
            return await report.save();
        } catch (e) {
            return { message: e.message };
        }
    }

    async saveNewPurchase(user_id, type, count) {
        let newUserPurchases = null;
        let countValid = Number(count);
        try {
            if (type === 'GIFT' && typeof countValid === 'number' && countValid > 0) {
                newUserPurchases = await this.model.findByIdAndUpdate(
                    user_id,
                    { $inc: { gifts: countValid } },
                    {
                        upsert: true,
                        new: true,
                    }
                );
            }
            if (type === 'SLIDE' && typeof countValid === 'number' && countValid > 0) {
                newUserPurchases = await this.model.findByIdAndUpdate(
                    user_id,
                    { $inc: { slides: countValid } },
                    {
                        upsert: true,
                        new: true,
                    }
                );
            }

            if (!newUserPurchases) {
                return { message: 'Incorrect type of purchase or count ! ' };
            } else {
                return newUserPurchases.transform();
            }
        } catch (e) {
            return { message: e.message };
        }
    }

    async updateOwnPurchaseCountDec(user_id, type) {
        try {
            if (type === 'GIFT') {
                return await this.model.findByIdAndUpdate(user_id, { $inc: { gifts: -1 } });
            }
            if (type === 'SLIDE') {
                return await this.model.findByIdAndUpdate(user_id, { $inc: { slides: -1 } });
            }
        } catch (e) {
            return { message: e.message };
        }
    }

    async saveSlide(user_id, oppositeUserId) {
        try {
            let slide = new this.slideModal({ userId: user_id, oppositeUserId: oppositeUserId });
            return await slide.save();
        } catch (e) {
            return { message: e.message };
        }
    }

    async getSlides(user_id) {
        try {
            return await this.slideModal.find({ oppositeUserId: user_id });
        } catch (e) {
            return { message: e.message };
        }
    }

    async saveNewReportProblem(user_id, text, platform) {
        let user = null;
        try {
            user = await this.model.findById(user_id);
            if (user) {
                let reportedProblem = new this.reportProblemModal({
                    userId: user_id,
                    text: text,
                    platform: platform,
                    user: user,
                });
                return await reportedProblem.save();
            } else {
                return { message: 'Report is not saved !' };
            }
        } catch (e) {
            return { message: e.message };
        }
    }

    async getUserReactedList(user_id) {
        try {
            return await this.reportWithReasonModel.find({ userId: user_id });
        } catch (e) {
            return null;
        }
    }
};

module.exports = {
    UserRepository,
};
