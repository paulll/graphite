const vk = new EventEmitter2;

vk.friendsCache = new Map;
vk.users = new Map;

vk.callback = new Map;
vk.lastCID = 0;

vk.PENDING = 0;

vk._userTimer = 0;
vk._userQueue = new Set;
vk._queue = new PriorityQueue({ comparator: (a, b) => b.priority - a.priority});

vk._rawApiRequest = (method, params={}, callback, _deph=0) => {
	let qs = '';
	for (let param of Object.keys(params))
		qs += `&${param}=${encodeURIComponent(params[param])}`;

	const s = document.createElement('script');
	const cid = vk.lastCID++;

	const token = params.hasOwnProperty('access_token') ? '' : `&access_token=${settings.service_token}`;

	s.src = `https://api.vk.com/method/${method}?callback=vk.callback.get(${cid})${qs}${token}&v=5.56`;
	s.type = 'text/javascript';

	document.head.appendChild(s);

	setTimeout(async () => {
		if (vk.callback.has(cid)) {
			document.head.removeChild(s);
			vk.callback.delete(cid);
			if (_deph > 10)
				return callback({error: 'Request Failed', error_code: 0});
			vk._rawApiRequest(method, params, callback, _deph+1);
		}
	}, 5000);

	vk.callback.set(cid, (data) => {
		document.head.removeChild(s);
		vk.callback.delete(cid);
		callback(data.error, data.response);
	});
};
vk._promiseApiRequest = Promise.promisify(vk._rawApiRequest);
vk._nextRequest = () => {
	if (vk.callback.size < settings.downloadThreads && vk._queue.length) {
		const {method, params, fulfill, reject} = vk._queue.dequeue();
		vk._rawApiRequest(method, params, (e,d) => {
			if (e) {reject(e)} else {fulfill(d)}
		});
	}
};
vk.enqueue = async (method, priority=10, params) => {
	let result;
	vk.PENDING++;

	try {
		if (vk.callback.size > settings.downloadThreads)
			result = await new Promise((fulfill,reject) => vk._queue.queue({method, params, priority, fulfill, reject}));
		else
			result = await vk._promiseApiRequest(method, params);
	} finally {
		vk.PENDING--;
		setTimeout(vk._nextRequest, 0);
		return result;
	}
};

vk.getFriends = async (user, priority=10, private=false) => {
	const cached = vk.friendsCache.get(user);
	if (cached) return cached;
	try {
		const params = {user_id: user};
		if (private)
			params.access_token = settings.access_token;

		const friends = (await vk.enqueue('friends.get', priority, params )).items;
		vk.friendsCache.set(user, friends);

		setTimeout( () => {
			vk.emit('userFriendsDownloaded', user, friends);
		}, 0);

		return friends;
	} catch (e) {
		if (!private && settings.access_token) {
			return await vk.getFriends(user, priority*2, true);
		}
		vk.friendsCache.set(user, []);
		return [];
	}
};

vk._getUsersInfo = async (priority, users) => {
	const loaded = (await vk.enqueue('users.get', priority, {fields:'sex,photo_max',user_ids: users.join(',')}))
	for (let user of loaded)
		vk.users.set(user.id, user);
	return loaded;
};

vk.getUserInfo = async (user) => {
	if (vk.users.has(user))
		return vk.users.get(user);
	vk._userQueue.add(user);
	clearTimeout(vk.userTimer);
	vk.userTimer = setTimeout(async () => {
		vk.getUsersInfo(vk._userQueue, 11);
		vk._userQueue = new Set;
	}, 50);
};

vk.getUsersInfo = async (users, priority=9) => {
	const uniqUsers = Array.from(new Set(users));
	const usersInfo = [].concat(...(await Promise.map(uniqUsers.filter(user => !vk.users.has(user)).chunk(200), vk._getUsersInfo.bind(null, priority))));
	setTimeout ( () => {
		for (let user of usersInfo)
			if (user)
				vk.emit('userInfoDownloaded', user)
	}, 0);
	return usersInfo;
};
