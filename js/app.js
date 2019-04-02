const app = new EventEmitter2;

app.manualDisplayedPersons = new Set;
app.displayedPersons = new Set;
app.selectedPersons = new Set;
app.graph = createGraph();
app.firstPerson = 0;

app.addManualDisplayedPerson = async (personId) => {
	app.firstPerson = app.firstPerson || personId;

	// download person info & friends

	app.manualDisplayedPersons.add(personId);
	app.displayedPersons.add(personId);

	// instantly create node
	if (!ui.graph.getNode(personId))
		ui.graph.addNode(personId);

	await Promise.all([
		vk.getUserInfo(personId),
		vk.getFriends(personId)
	]);

	// no additional requests here, value is always cached
	const friends = new Set(await vk.getFriends(personId));

	for (let friend of friends)
		app.displayedPersons.add(friend);

	// also hidden ones
	app.graph.forEachLinkedNode(personId, (linked) => {
		friends.add(linked.id);
		app.displayedPersons.add(linked.id);
	}, false);

	const friendsArray = Array.from(friends);

	// load friends' friend lists and user info
	await Promise.all([
		vk.getUsersInfo(friendsArray),
		Promise.all(friendsArray.map(async (friend) => {
			await vk.getFriends(friend);
		}))
	]);

	ui._layout.pinNode(ui.graph.getNode(app.firstPerson), true);
	ui.resetLinks(+personId);
};

app.addDisplayedPerson = (personId) => {
	app.displayedPersons.add(personId);

	vk.getUserInfo(personId);

	app.graph.forEachLinkedNode(personId, (node) => {
		if (!app.displayedPersons.has(node.id)) return;
		if (!ui.graph.hasLink(node.id, personId) && app.graph.hasLink(node.id, personId))
			ui.graph.addLink(node.id, personId);
		if (!ui.graph.hasLink(personId, node.id) && app.graph.hasLink(personId, node.id))
			ui.graph.addLink(personId, node.id);
	}, false);
};

app.searchUserByString = async (search) => {
	search = search.toLowerCase().trim();
	try {
		search = (+(await vk('users.get', {v:5.56,user_ids:search}))[0].id);
	} catch (e) {}

	const found = new Set;
	for (let user of vk.users.values()) {
		if (ui.graph.getNode(+user.id) && (user.first_name.toLowerCase().startsWith(search)
			|| user.last_name.toLowerCase().startsWith(search)
			|| (user.first_name + user.last_name).toLowerCase().startsWith(search)
			|| (user.last_name + user.first_name).toLowerCase().startsWith(search)
			|| +user.id == +search )) found.add(+user.id);
	}
	return found;
};

app.startExtendCommunityCluster = () => {
	const progress = new EventEmitter2;
	const selected = new Set(app.selectedPersons);
	let last = 0, stop=false;

	progress.on('stop', ()=>stop=true);

	const start = async () => {
		const linkedMap = new Map;
		const threshold = Math.max(Math.floor(Math.log2(selected.size)), 3);

		for (let person of selected) {
			app.graph.forEachLinkedNode(person, (linked) => {
				if (linkedMap.has(linked.id))
					linkedMap.set(linked.id, linkedMap.get(linked.id) + 1)
				else
					linkedMap.set(linked.id, 1);
			}, false);
		}

		const arr = Array.from(linkedMap.entries()).filter(x => x[1] > threshold).sort((a, b) => b[1] - a[1]);
		let j = arr.length;
		for (let [fof, weight] of arr) {
			if (stop) return process.emit('progress', 'остановлено');
			progress.emit('progress', `д^3 вес: ${weight}/${threshold} (${j--}) `);
			app.addDisplayedPerson(fof);
			selected.add(fof);
			await vk.getFriends(fof);
		}

		if (arr.length !== last) {
			last = arr.length;
			setTimeout(start, 0)
		}
	};

	setTimeout(start, 0);
	return progress;
};

app.startExtendCommunity = () => {
	const progress = new EventEmitter2;
	const selected = new Set(app.selectedPersons);
	const initialSelected = new Set(app.selectedPersons);
	const threshold = Math.max(Math.floor(Math.log2(selected.size)), 3);
	let last = 0, stop=false;

	progress.on('stop', ()=>stop=true);

	const start = async () => {
		const linkedMap = new Map;

		for (let person of selected) {
			app.graph.forEachLinkedNode(person, (linked) => {
				if (linkedMap.has(linked.id))
					linkedMap.set(linked.id, linkedMap.get(linked.id) + 1)
				else
					linkedMap.set(linked.id, 1);
			}, false);
		}

		const arr = Array.from(linkedMap.entries()).filter(x => {
			if (x[1] < 2) return false;

			let success = false;

			app.graph.forEachLinkedNode(x[0], (node) => {
				if (initialSelected.has(node.id))
					return success = true;
			}, false);

			return success && (x[1] > threshold);
		}).sort((a, b) => b[1] - a[1]);

		let j = arr.length;
		for (let [fof, weight] of arr) {
			if (stop) return progress.emit('progress', 'остановлено');
			progress.emit('progress', `д^3 вес: ${Math.round(weight*1000)}/${Math.round(threshold*1000)} (${j--}) `);
			app.addDisplayedPerson(fof);
			selected.add(fof);
			await vk.getFriends(fof);
		}

		if (arr.length !== last) {
			last = arr.length;
			app.updateSelection(new Set(selected));
			setTimeout(start, 0)
		}
	};

	setTimeout(start, 0);
	return progress;
};

app.startDeepHiddenSearch = (userId) => {
	let last = 0, stop = false;
	const progress = new EventEmitter2;

	progress.on('stop', ()=>stop=true);
	const start = async () => {
		progress.emit('progress', `инициализация`);
		await app.addManualDisplayedPerson(userId);

		if (app.displayedPersons.has(userId)) {
			// список друзей уже загружен

			const friendsOfFriends = new Map;
			const friends = new Set;

			progress.emit('progress', 'д^1');
			app.graph.forEachLinkedNode(userId, (linked) => {
				friends.add(linked.id);
			}, false);

			await Promise.map(friends, async (friend, i) => {
				progress.emit('progress', `д^2 индекс: ${i}`);
				for (let friendOfFriend of await vk.getFriends(friend)) {
					friendsOfFriends.has(friendOfFriend)
						? friendsOfFriends.set(friendOfFriend, friendsOfFriends.get(friendOfFriend) + 1)
						: friendsOfFriends.set(friendOfFriend, 1);
				}
			});

			const arr = Array.from(friendsOfFriends.entries()).filter(x => x[1] > 1).sort((a, b) => b[1] - a[1]);
			let j = arr.length;
			for (let [fof, weight] of arr) {
				if (weight < 2) break;
				if (stop) return progress.emit('progress', 'остановлено');
				progress.emit('progress', `д^3 вес: ${weight} (${j--})`);
				await vk.getFriends(fof);
			}

			if (arr.length !== last) {
				last = arr.length;
				setTimeout(start, 0)
			}

			progress.emit('progress', `всё!`);
		} else {
			progress.emit('progress', 'ошибка')
		}
	};

	setTimeout ( start, 0);
	return progress;
};

app.updateSelection = (selection) => {
	app.emit('selectionChanged', selection, app.selectedPersons);
	app.selectedPersons = selection;
};

vk.on('userInfoDownloaded', (user) => {
	const colors = {
		0: 0x1c1c1cff, // n/a
		1: 0xFF0048EE, // female
		2: 0x009DFFEE, // male
		3: 0x1c1c1c88  // [DATA EXPUNGED] or trap
	};

	// change user color depending on sex
	ui.nodeColors.set(user.id, colors[user.sex || 0]);
	ui.resetNodeUI(user.id);
});

vk.on('userFriendsDownloaded', (user, friendList) => {
	// update full graph
	for (let friend of friendList) {
		app.graph.addLink(user, friend);

		if (app.manualDisplayedPersons.has(friend)) {
			app.addDisplayedPerson(user);
		}

		if (app.displayedPersons.has(user) && app.displayedPersons.has(friend)) {
			ui.graph.addLink(user, friend);
		}
	}

	if (app.displayedPersons.has(user)) {
		ui.resetLinks(user);
	}
});

