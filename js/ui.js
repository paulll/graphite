const ui = {};

ui.graph = ngraph_graph();

ui._graphics = Viva.Graph.View.webglGraphics();
ui._layout = Viva.Graph.Layout.forceDirected(ui.graph, {
    springLength: 20,
    springCoeff: 1e-4,
    dragCoeff: 0.05,
    gravity: -10,
});
ui._renderer = Viva.Graph.View.renderer(ui.graph, {
  container: document.getElementById('graph-wrap'),
  interactive: +'node drag',
  graphics : ui._graphics,
  layout: ui._layout,
  renderLinks : true,
  prerender  : true
});

ui._events = Viva.Graph.webglInputEvents(ui._graphics, ui.graph);

ui.nodeColors = new Map;
ui.nodeSizes = new Map;

ui.resetLinks = (node_id) => {
	if (ui.graph.getNode(node_id))
		for (let link of ui.graph.getNode(node_id).links)
		ui._graphics.getLinkUI(link.id).color = ui.getLinkUI(link).color;
};

ui.resetNodeUI = (node_id) => {
	if (ui.graph.getNode(node_id))
		ui._graphics.getNodeUI(node_id).color = ui.nodeColors.get(node_id);
};

ui.getLinkUI = (link) => {
	if (link.data && link.data.color)
		return {color: link.data.color};

	if (!vk.friendsCache.has(+link.toId) || !vk.friendsCache.has(+link.fromId) || !vk.friendsCache.get(+link.toId).length || !vk.friendsCache.get(+link.fromId).length)
		return {color: settings.privateColor};

	if (!ui.graph.hasLink(+link.toId,+link.fromId))
		return {color: settings.hiddenColor};

	return {color: settings.defaultColor};
};

ui.getNodeUI = (node) => {
	return {
		size: ui.nodeSizes.get(+node.id) || settings.nodeSize, 
		color: ui.nodeColors.get(+node.id) || settings.defaultColor
	};
};

app.on('selectionChanged', (selection, oldSelection) => {
	console.log(selection, oldSelection);

	for (let personId of oldSelection) {
		if (selection.has(personId)) continue;
		const nodeUI = ui.getNodeUI(ui.graph.getNode(personId));
		ui._graphics.getNodeUI(personId).size = nodeUI.size;
		ui._graphics.getNodeUI(personId).color = nodeUI.color;
	}

	for (let personId of selection) {
		if (oldSelection.has(personId)) continue;
		if (settings.selectionByColor) ui._graphics.getNodeUI(personId).color = ui.getNodeUI(ui.graph.getNode(personId)).color&0xffffff00 + 0xff
		else ui._graphics.getNodeUI(personId).size = ui.getNodeUI(ui.graph.getNode(personId)).size * 2;
	}
});


ui._mouseEntered = false;
ui.events = {
	mouseEnter (node) {
		if (ui._mouseEntered)
			ui.events.mouseLeave(ui._mouseEntered);
		ui._mouseEntered = node;

		// show helper
		ui.helper.help(
			vk.users.has(node.id)
				? `${vk.users.get(node.id).first_name} ${vk.users.get(node.id).last_name}`
				: node.id);

		// highlight
		for (let link of ui.graph.getNode(node.id).links) {
			const hasOutgoing = ui.graph.hasLink(node.id, link.toId === node.id? link.fromId : link.toId);
			const hasIncoming = ui.graph.hasLink(link.toId === node.id? link.fromId : link.toId, node.id);

			ui._graphics.getLinkUI(link.id).color = settings.highlightDefault;
			if (hasIncoming && !hasOutgoing)
				ui._graphics.getLinkUI(link.id).color = settings.highlightIncoming;
			if (!hasIncoming && hasOutgoing)
				ui._graphics.getLinkUI(link.id).color = settings.highlightOutgoing;

			//ui._graphics.getLinkUI(link.id).color = ui._graphics.getNodeUI(node.id).color;
			if (ui._graphics.getLinkUI(link.id).color !== settings.defaultColor)
				ui._graphics.bringLinkToFront(ui._graphics.getLinkUI(link.id));
		}
	},
	mouseLeave (node) {
		ui._mouseEntered = false;

		// hide helper
		ui.helper.hide();

		// reset highlighted links
		for (let link of ui.graph.getNode(+node.id).links)
			ui._graphics.getLinkUI(link.id).color = ui.getLinkUI(link).color;
	},
	mouseClick (node) {
		if (ui._keyCtrl) {
			const selection = new Set(app.selectedPersons);
			if (selection.has(node.id))
				selection.delete(node.id);
			else
				selection.add(node.id);
			app.updateSelection(selection);

			if (selection.size > 2) {
				$('#group').removeClass('hidden');
				$('#extend-unlimited').text('дополнить кластер (много!)');
				document.getElementById('extend-unlimited').onclick = () => {
					const progress = app.startExtendCommunityCluster();
					progress.on('progress', status => {
						$('#extend-unlimited').text(status);
					});
				}
				$('#extend').text('дополнить сообщество');
				document.getElementById('extend').onclick = () => {
					const progress = app.startExtendCommunity();
					progress.on('progress', status => {
						$('#extend').text(status);
					});
				}
			} else {
				$('#group').addClass('hidden');
			}

			return false;
		}

		$('#avatar').addClass('active');
		$('#group').addClass('hidden');

		app.updateSelection(new Set([+node.id]));

		$('#avatar').css('background-image', 'url('+vk.users.get(+node.id).photo_max+')');
		$('#name').text(vk.users.get(+node.id).first_name + ' ' + vk.users.get(+node.id).last_name);
		$('#id').text(''+node.id);
		$('#name').attr('href', 'http://vk.com/id'+node.id);
		$('#hiddensearch').text('(найти больше?)');
		document.getElementById('hiddensearch').onclick = () => {
			const progress = app.startDeepHiddenSearch(node.id);
			progress.on('progress', status => {
				$('#hiddensearch').text(status);
			});
		};
		document.getElementById('name').onclick =  () =>  {
			return window.open('https://vk.com/id'+node.id, '_blank') && false;
		};

		const hidden = new Set;
		const hiddenBy = new Set;

		ui.graph.forEachLinkedNode(+node.id, (linked) => {
			const inTargetFriends = ui.graph.hasLink(+node.id, +linked.id);
			const inLinkedFriends = ui.graph.hasLink(+linked.id, +node.id);
			if (inTargetFriends && !inLinkedFriends) return hiddenBy.add(+linked.id) && false;
			if (!inTargetFriends && inLinkedFriends) return hidden.add(+linked.id) && false;
		}, false);

		$('#hidden').text(hidden.size);
		$('#hidden-by').text(hiddenBy.size);
		document.getElementById('hidden').onclick = () => {app.updateSelection(hidden)};
		document.getElementById('hidden-by').onclick = () => {app.updateSelection(hiddenBy)};
	},

	doubleClick (node) {
		app.addManualDisplayedPerson(+node.id)
	}
};

ui.helper = {
	element: document.getElementById('current')
};

window.addEventListener('keydown', (e) => {
	if (e.keyCode === 17) ui._keyCtrl = true;
	if (e.keyCode === 16) ui._keyShift = true;
});

window.addEventListener('keyup', (e) => {
	if (e.keyCode === 17) ui._keyCtrl = false;
	if (e.keyCode === 16) ui._keyShift = false;
});

window.addEventListener('mousemove', function (event) {
	ui.helper.element.style['-webkit-transform'] = 'translate3d(' + event.pageX + 'px, ' + event.pageY + 'px, 0)'
});

ui.helper.help = function (s) {
	ui.helper.element.style.opacity = 1;
	ui.helper.element.textContent = s;
};

ui.helper.hide = function () {
	ui.helper.element.style.opacity = 0;
};





//
// DEBG
//

const displayDebugInfo = () => {
	$('#s_edges').text(ui.graph.getLinksCount());
	$('#s_verts').text(ui.graph.getNodesCount());
	$('#s_real_edges').text(app.graph.getLinksCount());
	$('#s_real_verts').text(app.graph.getNodesCount());

	requestAnimationFrame(displayDebugInfo);
};


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

ui._events
	.mouseEnter(ui.events.mouseEnter)
	.mouseLeave(ui.events.mouseLeave)
	.dblClick(ui.events.doubleClick)
	.click(ui.events.mouseClick);
ui._graphics.node(ui.getNodeUI);
ui._graphics.link(ui.getLinkUI);
ui._renderer.run();
app.addManualDisplayedPerson(150547176);
requestAnimationFrame(displayDebugInfo);
