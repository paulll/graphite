var graph = Viva.Graph.graph();
var service_token = "590b7e5b590b7e5b590b7e5bea596a14f85590b590b7e5b039be32ce7e754aab89565f1";
var graphics = Viva.Graph.View.webglGraphics();
var layout = Viva.Graph.Layout.forceDirected(graph, {
    springLength: 20,
    springCoeff: 1e-4,
    dragCoeff: 0.05,
    gravity: -10,
});
var renderer = Viva.Graph.View.renderer(graph, {
  container: document.getElementById('graph-wrap'),
  interactive: +'node drag',
  graphics : graphics,
  layout: layout,
  renderLinks : true,
  prerender  : true
});
var events = Viva.Graph.webglInputEvents(graphics, graph);

const settings = {
	hiddenColor: 1258324735,
	defaultColor: 85,
	nodeSize: 30,
	persistentCache: false,
	preloadUserInfo: true,
	smartPreload: false,
	downloadThreads: 5
}

// https://stackoverflow.com/questions/217578/how-can-i-determine-whether-a-2d-point-is-within-a-polygon
// 

const db = new Dexie('vk.cache.1');
db.version(1).stores({
	friends: 'user,friends,ttl',
	users: 'user,first_name,last_name,sex,photo_max,ttl'
});

const vk = (method, params={}) => {
	return new Promise((fulfill, reject) => {
		let qs = '';
		for (let param of Object.keys(params))
			qs += `&${param}=${encodeURIComponent(params[param])}`;

		const s = document.createElement('script');
		const cid = vk.callback.last++;
		s.src = 
		`https://api.vk.com/method/${method}?callback=vk.callback.get(${cid})${qs}&access_token=${service_token}`
		s.type = 'text/javascript';

		document.head.appendChild(s);

		vk.callback.set(cid, (data) => {
			document.head.removeChild(s);
			vk.callback.delete(cid);
			if (data.error) return reject(data.error);
			return fulfill(data.response);
		});
	});
}

vk._requestQueue = new PriorityQueue({ comparator: (a, b) => b.priority - a.priority});
vk._pendingRequests = 0;
vk._nextRequest = async () => {
	if (vk._requestQueue.length > 0) {
		vk._pendingRequests++;
		const {request, fulfill, reject} = vk._requestQueue.dequeue();
		try {
			const result = await vk.apply(null, request);
			fulfill(result);
		}
		catch (e) {reject(e)}
		finally {vk._pendingRequests--; setTimeout(vk._nextRequest,0)}
	}
}
vk.enq = async (method, priority, params) => {
	if (vk._pendingRequests < settings.downloadThreads) {
		vk._pendingRequests++;
		const result = await vk(method, params);
		vk._pendingRequests--;
		vk._nextRequest();
		return result;
	} else {
		return await (new Promise((fulfill,reject) => vk._requestQueue.queue({request: [method,params], fulfill, reject, priority})))
	}
}

vk.callback = new Map;
vk.callback.last = 0;
vk.users = new Map;
vk.userColors = new Map;
vk.friendsCache = new Map;
vk.realgraph = Viva.Graph.graph();

vk.getFriends = async (user, priority=10) => {
	const cached = vk.friendsCache.get(user);
	if (cached) return cached;
	try {
		if (settings.persistentCache) {
			const friends_prob = await db.friends.get(user);
			if (friends_prob && friends_prob.ttl > Date.now()) {
				vk.friendsCache.set(user, friends_prob.friends);
				return friends_prob.friends;	
			}
		}

		const friends = (await vk.enq('friends.get', priority, {user_id: user,v:5.56})).items;
		vk.friendsCache.set(user, friends);
		if (settings.persistentCache) db.friends.put({user, friends, ttl: Date.now() + 1000*60*60}) // 1h

		return friends;
	} catch (e) {vk.friendsCache.set(user, []); return []}
}

vk._getUsersInfo = async (priority, users) => {
	for (let user of (await vk.enq('users.get', priority, {fields:'sex,photo_max',user_ids: users.join(','),v:5.56}))) {
		vk.users.set(user.id, user);
		if (settings.persistentCache) db.users.put({user: +user.id, ttl: Date.now() + 1000*60*60*24*7, data: user})
		if (graph.getNode(+user.id)) 
			graphics.getNodeUI(+user.id).color = vk.getNodeUI(graph.getNode(+user.id)).color; 
	}
}

vk.getUsersInfo = async (users, priority=9) => {
	const not_cached = await Promise.filter(users, async (user) => {
		if (vk.users.has(user)) return false;
		if (!settings.persistentCache) return true; 
		const user_prob = await db.users.get(user);
		if (user_prob && user_prob.ttl > Date.now()) { 
			vk.users.set(user, user_prob.data);
			graphics.getNodeUI(+user).color = vk.getNodeUI(graph.getNode(+user)).color;
			return false;
		}
		return true;
	});
	return await Promise.map(not_cached.chunk(200), vk._getUsersInfo.bind(null, priority));
}

vk._loadedPersons = new Set;
vk._manualLoadedPersons = new Set;
vk.handleLoadPerson = async (user, bg=false) => {
	const userFriends = await vk.getFriends(+user, bg?20:120);
	vk._loadedPersons.add(+user);

	if (!bg) {
		vk._manualLoadedPersons.add(+user);
		for (let friend of userFriends) {
			vk.realgraph.addLink(+user, +friend);
		}
		await vk.getUsersInfo(new Set([+user, ...userFriends]), 110);

		// hidden detect
		vk.realgraph.forEachLinkedNode(+user, (node, link) => {
			if (!graph.hasLink(link.fromId, link.toId)) graph.addLink(link.fromId, link.toId)
		});
	}

	const getinfoq = new Set();

	await Promise.map(userFriends, async (friend) => {
		const friendFriends = await vk.getFriends(friend, bg?7:107);

		for (let friendfriend of friendFriends) { 
			if (bg&&vk._manualLoadedPersons.has(+friendfriend) || !bg&&graph.getNode(friendfriend))
				graph.addLink(+friend, +friendfriend);
			vk.realgraph.addLink(+friend, +friendfriend);
			getinfoq.add(+friendfriend);
		}

		if (graph.getNode(+friend)) vk.resetLinks(+friend);
	});

	vk.resetLinks(+user);
	if (!bg && settings.preloadUserInfo) await vk.getUsersInfo(getinfoq, 105);
}

vk._nextBackgroundPerson = async () => {
	if (!settings.smartPreload) return false; 
	const dc = Viva.Graph.centrality().degreeCentrality(graph);
	const toload = dc.filter(x=>!vk._loadedPersons.has(+x.key)).sort((a,b) => b.value - a.value).slice(0, 3);
	if (!toload.length) return console.log('preloaded all'), setTimeout(vk._nextBackgroundPerson, 5000);
	for (let {key, value} of toload) await vk.handleLoadPerson(+key, true);
	setTimeout(vk._nextBackgroundPerson, 0);
}

vk.resetLinks = (node_id) => {
	for (let link of graph.getNode(node_id).links) {
		graphics.getLinkUI(link.id).color = vk.getLinkUI(link).color;
	};
}

vk.getLinkUI = (link) => {
	if (link.data && link.data.color)
		return {color: link.data.color};

	if (!!graph.hasLink(+link.fromId, +link.toId) + !!graph.hasLink(+link.toId,+link.fromId) == 1)
		return {color: settings.hiddenColor};

	return {color: settings.defaultColor};
}

vk.customNodeColors = new Map;
vk.customNodeSizes = new Map;

vk.getNodeUI = (node) => {

	const customSize = vk.customNodeSizes.get(+node.id);
	const customColor = vk.customNodeColors.get(+node.id);

	if (customColor)
		return {size: customSize || settings.nodeSize, color: customColor};

	let s = 3;
	if (vk.users.has(+node.id))
		s = vk.users.get(+node.id).sex;

	switch (s) {
		case 1: return {size: customSize || settings.nodeSize, color: 0xFF0048EE};
		case 2: return {size: customSize || settings.nodeSize, color: 0x009DFFEE};
		case 3: return {size: customSize || settings.nodeSize, color: 0x1c1c1c88};
		default: return {size: customSize || settings.nodeSize/2, color: 0x1c1c1cff};
	}
}

vk._selectedNodes = new Set;
vk._colorSelect = false;
vk.select = (ids) => {



	for (let searched of vk._selectedNodes) {
		const nodeui = vk.getNodeUI(graph.getNode(searched));
		graphics.getNodeUI(searched).size = nodeui.size;
		graphics.getNodeUI(searched).color = nodeui.color;
	}

	vk._selectedNodes = new Set(ids);

	for (let searched of vk._selectedNodes) {
		if (vk._colorSelect) graphics.getNodeUI(searched).color = vk.getNodeUI(graph.getNode(searched)).color&0xffffff00 + 0xff 
		else graphics.getNodeUI(searched).size = vk.getNodeUI(graph.getNode(searched)).size * 2;
	}
}
vk.search = async (search) => {
	search = search.toLowerCase().trim();
	try {
		search = (+(await vk('users.get', {v:5.56,user_ids:search}))[0].id);
	} catch (e) {}
	const found = new Set;
	for (let user of vk.users.values()) {
		if (graph.getNode(+user.id) && (user.first_name.toLowerCase().startsWith(search) 
			|| user.last_name.toLowerCase().startsWith(search)
			|| (user.first_name + user.last_name).toLowerCase().startsWith(search)
			|| (user.last_name + user.first_name).toLowerCase().startsWith(search)
			|| +user.id == +search )) found.add(+user.id);
	}
	return found;
}

vk._hoveredLinks = []
vk.events = {
	mouseEnter (node) {
		// helper + highlight
		// 
		
		vk.helper.help(vk.users.has(node.id)?vk.users.get(node.id).first_name+' '+vk.users.get(node.id).last_name:node.id);
		
		vk._hoveredLinks.forEach((link) => {
			let ui = graphics.getLinkUI(link.id);
			if (ui) ui.color = vk.getLinkUI(link).color;
		});

		if (vk.userColors.has(+node.id)) {
			return vk._hoveredLinks = [];
		}

		vk._hoveredLinks = graph.getNode(node.id).links;

		for (let link of vk._hoveredLinks) {	
			graphics.getLinkUI(link.id).color = settings.circles?Math.floor(graphics.getNodeUI(node.id).color * 0x100 + 0xFF):graphics.getNodeUI(node.id).color;
			graphics.bringLinkToFront(graphics.getLinkUI(link.id));
		}
	},
	mouseLeave (node) {
		// helper.hide 

		vk.helper.hide();

		for (let link of graph.getNode(+node.id).links){
			graphics.getLinkUI(link.id).color = vk.getLinkUI(link).color;
		};
	},
	mouseClick (node) {
		$('#avatar').addClass('active');
		vk.current = node.id;
		vk.select([node.id]);

		if (false&&shifted) {
			graph.removeNode(node.id);
		} else {
			$('#avatar').css('background-image', 'url('+vk.users.get(+node.id).photo_max+')');
			$('#name').text(vk.users.get(+node.id).first_name + ' ' + vk.users.get(+node.id).last_name);
			$('#id').text(''+node.id);
			$('#name').attr('href', 'http://vk.com/id'+node.id);
			document.getElementById('name').onclick = function () {
				return window.open('https://vk.com/id'+node.id, '_blank') && false;
			}
		}

		const hidden = new Set;
		const hiddenBy = new Set;

		vk.realgraph.forEachLinkedNode(+node.id, (linked) => {
			const inTargetFriends = vk.realgraph.hasLink(+node.id, +linked.id);
			const inLinkedFriends = vk.realgraph.hasLink(+linked.id, +node.id);
			if (inTargetFriends && !inLinkedFriends) return hiddenBy.add(+linked.id) && false;
			if (!inTargetFriends && inLinkedFriends) return hidden.add(+linked.id) && false;
		}, true);

		$('#hidden').text(hidden.size);
		$('#hidden-by').text(hiddenBy.size);
		document.getElementById('hidden').parentNode.onclick = () => {vk.select(hidden)};
		document.getElementById('hidden-by').parentNode.onclick = () => {vk.select(Array.from(hiddenBy).filter(x=>graph.getNode(+x)))};
	},
	doubleClick (node) {
		vk.handleLoadPerson(+node.id)
	}
}

vk.helper = {
	element: document.getElementById('current')
};

window.addEventListener('mousemove', function (event) {
	vk.helper.element.style['-webkit-transform'] = 'translate3d(' + event.pageX + 'px, ' + event.pageY + 'px, 0)'
});

vk.helper.help = function (s) {
	vk.helper.element.style.opacity = 1;
	vk.helper.element.textContent = s;
};

vk.helper.hide = function () {
	vk.helper.element.style.opacity = 0;
};



// 
// CLI
// 
const commands = new Map;
const cli = (aliases, args_string, desc, func) => {
	$('#cli-hint').html($('#cli-hint').html() + `<div><span class="command">${aliases[0]}</span><span class="args">${args_string}</span><span class="desc">${desc}</span></div>` )
	for (let alias of aliases)
		commands.set(alias, func);
}

cli(['add', 'a'], '%id', 'Добавить на граф', async (id) => {
	if (!/^[0-9]+$/.test(id)) {
		try {
			vk.handleLoadPerson(+(await vk('users.get', {v:5.56,user_ids:id}))[0].id);
		} catch (e) {
			// resp err
		}
	} else vk.handleLoadPerson(+id);
})

cli(['rm', 'r'], '%id', 'Убрать с графа', (id) => {
	if (id) return graph.removeNode(+id);
	for (let node of vk._selectedNodes)
		graph.removeNode(node);
	vk._selectedNodes = new Set;
})

cli(['search', 'find', 'f', 's', 'sel', 'select'], '%search', 'Поиск / выбор', async (search) => {
	const found = await vk.search(search)
	if (found.size == 1) return vk.events.mouseClick(graph.getNode(found.values().next().value));
	vk.select(found);
});

cli(['expr', 'e'], '%expr', 'Выбор множества', async (expr) => {
	// selectors: 
	//  s - selected
	//  fsearch - friends of user
	//  usearch - user
	//  m - man
	// operations:
	//  + union
	//  ^ intersection
	//  - difference
	//  ! inverse
	//const tokens = expr.match(/\s*(\(|\)|s|[fu]%[^\^\s+-!]+|\+|\^|-|!)\s*/gi);

	jsep.addBinaryOp('+');
	jsep.addBinaryOp('-');
	jsep.addBinaryOp('^');
	jsep.addUnaryOp('!');
	jsep.removeBinaryOp('%');

	const ast = jsep(expr);

	const getM = () => {
		const ms = new Set;
		graph.forEachNode((node) => { 
			if (vk.users.get(+node.id).sex == 2) ms.add(+node.id);
		});
		return ms;
	}

	const getSet = async (identifier) => {
		if (identifier == 'm') return await getM();
		if (identifier == 's') return vk._selectedNodes;
		if (identifier[0] == 'u') return await vk.search(identifier.substr(1));
		if (identifier[0] == 'f') return new Set(Array.prototype.concat.apply([], Array.from(await vk.search(identifier.substr(1))).map(node => vk.friendsCache.get(node).filter(x=>graph.getNode(+x)))));
	}

	const compute = async (e) => {
		if (e.type == 'BinaryExpression') {
			const left = (e.left.type == 'Identifier') ? await getSet(e.left.name) : await compute(e.left);
			const right = (e.right.type == 'Identifier') ?  await getSet(e.right.name) : await compute(e.right);

			let result = new Set;
			if (e.operator == '+')
				result = new Set([...left, ...right]);
			if (e.operator == '^')
				for (let node of left)
					if (right.has(node))
						result.add(node);
			if (e.operator == '-')
				for (let node of left)
					if (!right.has(node))
						result.add(node);
			return result;
		}
		if (e.type == 'UnaryExpression' && e.operator == '!') {
			const right = await getSet(e.argument.name);
			const result = new Set;

			graph.forEachNode((node) => {
				if (!right.has(+node.id)) result.add(+node.id);
			});

			return result;
		}
		return new Set;
	};
	if (ast.type == 'Identifier')
		return vk.select(await getSet(ast.name));
	return vk.select(await compute(ast));
});

cli(['size'], '%mode', 'Размер', (mode) => {
	if (/^\d+$/.test(mode)) {settings.nodeSize = +mode; vk.customNodeSizes = new Map; vk._colorSelect = false; } else {vk._colorSelect = true}
	if (mode == 'bc') Viva.Graph.centrality().betweennessCentrality(graph).forEach(({key,value}) => vk.customNodeSizes.set(+key,Math.log(1+value)*settings.nodeSize));
	if (mode == 'dc') Viva.Graph.centrality().degreeCentrality(graph).forEach(({key,value}) => vk.customNodeSizes.set(+key,value));
	if (mode == 'bd') {
		const bc = Viva.Graph.centrality().betweennessCentrality(graph);
		const dc = Viva.Graph.centrality().degreeCentrality(graph);

		bc.forEach(({key,value}) => vk.customNodeSizes.set(+key, Math.log(1+value) * settings.nodeSize))
		dc.forEach(({key,value}) => vk.customNodeSizes.set(+key, (vk.customNodeSizes.get(+key) > value) ? vk.customNodeSizes.get(+key) - value : 10 ));
	}

	graph.forEachNode(node => {
		const nodeui = vk.getNodeUI(node);
		graphics.getNodeUI(+node.id).size = nodeui.size;
		graphics.getNodeUI(+node.id).color = nodeui.color;
	})
})

cli(['ai'], '%count', 'Догрузить в фоне', async (count) => {
	const dc = Viva.Graph.centrality().degreeCentrality(graph);
	const toload = dc.sort((a,b) => b.value - a.value).slice(0, +count);
	for (let {key, value} of toload) await vk.handleLoadPerson(+key, true);
});

cli(['flush'], '%what', 'Очистить кэш', (what) => {
	if (what.toLowerCase().trim() == 'users') db.users.clear();
	else if (what.toLowerCase().trim() == 'friends') db.friends.clear();
	else db.users.clear(), db.friends.clear();
})

//cli(['setcolor', 'color'], '%color', 'Выбрать цвет', (color) => {})

//
// DEBG
//

const displayDebugInfo = () => {
	$('#s_edges').text(graph.getLinksCount());
	$('#s_verts').text(graph.getNodesCount());
	$('#s_real_edges').text(vk.realgraph.getLinksCount());
	$('#s_real_verts').text(vk.realgraph.getNodesCount());

	requestAnimationFrame(displayDebugInfo);
};

//
//  HOOKS:
//  


Object.defineProperty(Array.prototype, 'chunk', {
    value: function(chunkSize) {
        var R = [];
        for (var i=0; i<this.length; i+=chunkSize)
            R.push(this.slice(i,i+chunkSize));
        return R;
    }
});

// 
// MAIN:
//

$('#console').cssConsole({onEnter: () => {
	const args = $('.cssConsoleInput').val().split(' ');
	const cmd = args.shift();
	const prog = commands.get(cmd);
	if (!prog) {
		$('.cssConsoleInput').val(':no such command');
		setTimeout(() => {
			$('.cssConsoleInput').val('')
		}, 500);
	} else {
		prog(...args);
		$('.cssConsoleInput').val(':running')
		$('.cssConsoleInput').val('')
	}
}});

$('.cssConsoleInput').on('blur', () => $('.cssConsoleInput').focus());
$('.cssConsoleInput').focus();

events
	.mouseEnter(vk.events.mouseEnter)
	.mouseLeave(vk.events.mouseLeave)
	.dblClick(vk.events.doubleClick)
	.click(vk.events.mouseClick);
graphics.node(vk.getNodeUI);
graphics.link(vk.getLinkUI);
renderer.run();
vk.handleLoadPerson(150547176)
setTimeout(vk._nextBackgroundPerson, 5000)

requestAnimationFrame(displayDebugInfo)
