import React, { FC, useCallback, useMemo } from 'react';
import IconButton from '@mui/material/IconButton';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark';
import ReplayIcon from '@mui/icons-material/Replay';
import { useQueryClient } from '@tanstack/react-query';

import { ItemAction } from 'constants/itemAction';
import { useApi } from 'hooks/useApi';
import { getChannelQuery } from 'hooks/api/liveTvHooks/useGetChannel';
import globalize from 'lib/globalize';
import { getReadablePrimaryActionUi, isReadableItem } from 'utils/readableActionUi';
import { playbackManager } from 'components/playback/playbackmanager';
import type { ItemDto } from 'types/base/models/item-dto';
import { ItemKind } from 'types/base/models/item-kind';
import itemHelper from 'components/itemHelper';

interface PlayOrResumeButtonProps {
    item: ItemDto;
    isResumable?: boolean;
    selectedMediaSourceId?: string | null;
    selectedAudioTrack?: number;
    selectedSubtitleTrack?: number;
}

const PlayOrResumeButton: FC<PlayOrResumeButtonProps> = ({
    item,
    isResumable,
    selectedMediaSourceId,
    selectedAudioTrack,
    selectedSubtitleTrack
}) => {
    const apiContext = useApi();
    const queryClient = useQueryClient();

    const playOptions = useMemo(() => {
        if (itemHelper.supportsMediaSourceSelection(item)) {
            return {
                startPositionTicks:
                    item.UserData && isResumable ?
                        item.UserData.PlaybackPositionTicks :
                        0,
                mediaSourceId: selectedMediaSourceId,
                audioStreamIndex: selectedAudioTrack || null,
                subtitleStreamIndex: selectedSubtitleTrack
            };
        }
    }, [
        item,
        isResumable,
        selectedMediaSourceId,
        selectedAudioTrack,
        selectedSubtitleTrack
    ]);

    const onPlayClick = useCallback(async () => {
        if (item.Type === ItemKind.Program && item.ChannelId) {
            const channel = await queryClient.fetchQuery(
                getChannelQuery(apiContext, {
                    channelId: item.ChannelId
                })
            );
            playbackManager.play({
                items: [channel]
            }).catch(err => {
                console.error('[PlayOrResumeButton] failed to play', err);
            });
            return;
        }

        playbackManager.play({
            items: [item],
            ...playOptions
        }).catch(err => {
            console.error('[PlayOrResumeButton] failed to play', err);
        });
    }, [apiContext, item, playOptions, queryClient]);

    const isReadable = useMemo(() => isReadableItem(item), [item]);

    const readableUi = useMemo(() => {
        if (!isReadable) return null;
        return getReadablePrimaryActionUi(item, !!isResumable, globalize);
    }, [isReadable, item, isResumable]);

    const titleText = readableUi ? readableUi.title : (
        isResumable ?
            globalize.translate('ButtonResume') :
            globalize.translate('Play')
    );

    const readableIcon = useMemo(() => {
        if (!readableUi) return null;

        switch (readableUi.icon) {
            case 'picture_as_pdf':
                return <PictureAsPdfIcon />;
            case 'auto_stories':
                return <AutoStoriesIcon />;
            case 'collections_bookmark':
                return <CollectionsBookmarkIcon />;
            default:
                return <MenuBookIcon />;
        }
    }, [readableUi]);

    return (
        <IconButton
            className='button-flat btnPlayOrResume'
            data-action={isResumable ? ItemAction.Resume : ItemAction.Play}
            title={titleText}
            onClick={onPlayClick}
        >
            {readableIcon ?? (isResumable ? <ReplayIcon /> : <PlayArrowIcon />)}
        </IconButton>
    );
};

export default PlayOrResumeButton;
