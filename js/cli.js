//
// CLI
//
const commands = new Map;
const cli = (aliases, args_string, desc, func) => {
	$('#cli-hint').html($('#cli-hint').html() + `<div><span class="command">${aliases[0]}</span><span class="args">${args_string}</span><span class="desc">${desc}</span></div>`);
	for (let alias of aliases)
		commands.set(alias, func);
};


cli(['add', 'a'], '%id', 'Добавить на граф', async (id) => {
	if (!/^[0-9]+$/.test(id)) {
		try {
			await app.addManualDisplayedPerson(+(await vk._promiseApiRequest('users.get', {v:5.56,user_ids:id}))[0].id);
		} catch (e) {
			// resp err
		}
	} else {
		try {
			await app.addManualDisplayedPerson(+id);
		} catch (e) {}
	}
});

cli(['rm', 'r'], '%id', 'Убрать с графа', (id) => {
	if (id) return ui.graph.removeNode(+id);
	for (let node of app.selectedPersons)
		ui.graph.removeNode(node);
	app.updateSelection(new Set);
});

cli(['search', 'find', 'f', 's', 'sel', 'select'], '%search', 'Поиск / выбор', async (search) => {
	const found = await app.searchUserByString(search);
	if (found.size === 1)
		return ui.events.mouseClick(ui.graph.getNode(found.values().next().value));
	else
		app.updateSelection(found);
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
		ui.graph.forEachNode((node) => {
			if (vk.users.get(+node.id).sex === 2) ms.add(+node.id);
		});
		return ms;
	};

	const getSet = async (identifier) => {
		if (identifier === 'm') return await getM();
		if (identifier === 's') return app.selectedPersons;
		if (identifier[0] === 'u') return await app.searchUserByString(identifier.substr(1));
		if (identifier[0] === 'f') return new Set([].concat(...Array.from(await app.searchUserByString(identifier.substr(1))).map(node => vk.friendsCache.get(node).filter(x=>ui.graph.getNode(+x)))));
	};

	const compute = async (e) => {
		if (e.type === 'BinaryExpression') {
			const left = (e.left.type === 'Identifier') ? await getSet(e.left.name) : await compute(e.left);
			const right = (e.right.type === 'Identifier') ?  await getSet(e.right.name) : await compute(e.right);

			let result = new Set;
			if (e.operator === '+')
				result = new Set([...left, ...right]);
			if (e.operator === '^')
				for (let node of left)
					if (right.has(node))
						result.add(node);
			if (e.operator === '-')
				for (let node of left)
					if (!right.has(node))
						result.add(node);
			return result;
		}
		if (e.type === 'UnaryExpression' && e.operator === '!') {
			const right = await getSet(e.argument.name);
			const result = new Set;

			ui.graph.forEachNode((node) => {
				if (!right.has(+node.id)) result.add(+node.id);
			});

			return result;
		}
		return new Set;
	};
	if (ast.type === 'Identifier')
		return app.updateSelection(await getSet(ast.name));
	return app.updateSelection(await compute(ast));
});

cli(['size'], '%mode', 'Размер', (mode) => {
	if (/^\d+$/.test(mode)) {settings.nodeSize = +mode; ui.nodeSizes = new Map; settings.selectionByColor = false } else {settings.selectionByColor = true}
	if (mode === 'bc') Viva.Graph.centrality().betweennessCentrality(ui.graph).forEach(({key,value}) => ui.nodeSizes.set(+key,Math.log(1+value)*settings.nodeSize));
	if (mode === 'dc') Viva.Graph.centrality().degreeCentrality(ui.graph).forEach(({key,value}) => ui.nodeSizes.set(+key,value));
	if (mode === 'bd') {
		const bc = Viva.Graph.centrality().betweennessCentrality(ui.graph);
		const dc = Viva.Graph.centrality().degreeCentrality(ui.graph);

		bc.forEach(({key,value}) => ui.nodeSizes.set(+key, Math.log(1+value) * settings.nodeSize));
		dc.forEach(({key,value}) => ui.nodeSizes.set(+key, (ui.nodeSizes.get(+key) > value) ? ui.nodeSizes.get(+key) - value : 10 ));
	}

	ui.graph.forEachNode(node => {
		const nodeui = ui.getNodeUI(node);
		ui._graphics.getNodeUI(+node.id).size = nodeui.size;
		ui._graphics.getNodeUI(+node.id).color = nodeui.color;
	})
});

//cli(['setcolor', 'color'], '%color', 'Выбрать цвет', (color) => {})